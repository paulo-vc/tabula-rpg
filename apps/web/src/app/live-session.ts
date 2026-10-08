import {
  err,
  linkedSheetId,
  ok,
  parseDice,
  roleOf,
  rollDice,
  valueProblem,
  type DieRoller,
  type RollEntry,
  type RollLogRepository,
  type Campaign,
  type CharacterSheet,
  type CompiledTemplate,
  type FieldValue,
  type SecretValuesRepository,
  type CampaignRepository,
  type DeviceRepository,
  type Issue,
  type Result,
  type SessionStateRepository,
  type SheetRepository,
} from '@tabula/domain';
import {
  fetchTemplate,
  SessionClient,
  SessionHost,
  type ClientStatus,
  type HostPlayer,
  type RemoteChanges,
  type SavedSheetState,
  type SyncTransport,
} from '@tabula/sync';
import { liveQuery, type Subscription } from 'dexie';
import type { TemplateCatalog } from './catalog';
import type { FileService, ImportResult } from './files';
import type { Clock } from './sheets';

/** Estado da sessão ao vivo deste dispositivo (no máximo uma por vez). */
export type LiveSession =
  | { kind: 'nenhuma' }
  | { kind: 'mestre'; campaignId: string; players: HostPlayer[]; connectionFailures: number }
  | {
      kind: 'jogador';
      campaignId: string;
      sheetId: string;
      status: ClientStatus;
      connectionFailures: number;
      /** Última alteração feita pelo Mestre na ficha (IDs dos campos), para avisar o jogador. */
      gmChange?: { fieldIds: string[]; count: number };
    };

/** Resultado de pedir o sistema ao Mestre: instalado, recusado pela instalação, ou sem resposta. */
export type TemplateReceipt =
  | ImportResult
  | { ok: false; reason: 'mestre-ausente' | 'falha-de-conexao' | 'cancelado' | 'campanha-ausente' };

export type TransportFactory = (room: { roomId: string; secret: string }) => SyncTransport;

/** Pausa antes de salvar o estado da sessão (as alterações chegam em rajadas). */
const SAVE_DELAY = 2000;

const IDLE: LiveSession = { kind: 'nenhuma' };

/**
 * Liga o motor de sincronização ao banco local e ao transporte. Expõe um retrato imutável
 * (`getSnapshot`) e avisos de mudança (`subscribe`), no formato do `useSyncExternalStore`.
 */
export class LiveSessionManager {
  private snapshot: LiveSession = IDLE;
  private readonly listeners = new Set<() => void>();
  private active: {
    stop: () => Promise<void>;
    save: () => Promise<void>;
    /** Só na sessão do Mestre: altera a ficha de um jogador. */
    setPlayerValues?: (sheetId: string, values: Record<string, FieldValue>) => boolean;
    campaignId: string;
    /** Quem rola nesta sessão (nome exibido no registro). */
    author: { id: string; name: string };
    /** Envia a rolagem à mesa (o Mestre não envia as secretas). */
    shareRoll: (entry: RollEntry) => void;
  } | null = null;
  private readonly rollListeners = new Set<(entry: RollEntry) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly sheets: SheetRepository,
    private readonly states: SessionStateRepository,
    private readonly device: DeviceRepository,
    private readonly createTransport: TransportFactory,
    private readonly clock: Clock,
    private readonly catalog: TemplateCatalog,
    private readonly files: FileService,
    private readonly secrets: SecretValuesRepository,
    private readonly rollLog: RollLogRepository,
    private readonly dieRoller: DieRoller,
    private readonly newId: () => string,
  ) {}

  getSnapshot = (): LiveSession => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** O Mestre abre a sessão: os jogadores com o convite podem se conectar. */
  async startAsGameMaster(campaignId: string): Promise<Result<void, Issue>> {
    const campaign = await this.campaigns.get(campaignId);
    if (!campaign) return failure('campanha-ausente', 'Campanha não encontrada.');
    if (roleOf(campaign, await this.device.getDeviceId()) !== 'mestre') {
      return failure('nao-e-mestre', 'Só o Mestre pode iniciar a sessão.');
    }
    await this.stop();

    const saved = new Map<string, SavedSheetState>();
    for (const record of await this.states.list(campaignId)) {
      if (!record.key.startsWith('mestre:') || !record.userId) continue;
      saved.set(record.key.slice('mestre:'.length), {
        userId: record.userId,
        displayName: record.displayName ?? 'Jogador',
        state: record.state,
      });
    }

    // O sistema vai junto para quem ainda não o tem (exceto nativos: todos já têm).
    const template = this.catalog.isBuiltin(campaign.templateRef.id)
      ? undefined
      : await this.catalog.get(campaign.templateRef.id);
    const host = new SessionHost(
      this.transportFor(campaign),
      {
        id: campaign.id,
        gmId: campaign.gmId,
        gmName: campaign.gmName,
        templateId: campaign.templateRef.id,
        ...(template ? { template } : {}),
      },
      saved,
    );
    host.seedRolls(await this.rollLog.list(campaignId));
    const stopRolls = host.onRoll((entry) => this.recordRolls(campaignId, [entry]));

    const publish = () =>
      this.setSnapshot({
        kind: 'mestre',
        campaignId,
        players: host.players(),
        connectionFailures: host.connectionFailures(),
      });
    const unsubscribe = host.subscribe(() => {
      publish();
      this.scheduleSave();
    });

    const save = () =>
      this.states.save(
        [...host.exportState()].map(([sheetId, entry]) => ({
          campaignId,
          key: `mestre:${sheetId}`,
          userId: entry.userId,
          displayName: entry.displayName,
          state: entry.state,
          updatedAt: this.clock.now(),
        })),
      );

    this.active = {
      save,
      stop: async () => {
        stopRolls();
        unsubscribe();
        await host.stop();
      },
      setPlayerValues: (sheetId, values) => host.setValues(sheetId, values),
      campaignId,
      author: { id: campaign.gmId, name: campaign.gmName },
      shareRoll: (entry) => host.roll(entry),
    };
    host.start();
    publish();
    return ok(undefined);
  }

  /** O jogador entra na sessão com a ficha vinculada à campanha. */
  async joinAsPlayer(campaignId: string): Promise<Result<void, Issue>> {
    const campaign = await this.campaigns.get(campaignId);
    if (!campaign) return failure('campanha-ausente', 'Campanha não encontrada.');
    const userId = await this.device.getDeviceId();
    const sheetId = linkedSheetId(campaign, userId);
    const sheet = sheetId ? await this.sheets.get(sheetId) : undefined;
    if (!sheetId || !sheet) {
      return failure('sem-ficha', 'Escolha ou crie sua ficha antes de entrar na sessão.');
    }
    await this.stop();

    const key = `jogador:${sheetId}`;
    const saved = (await this.states.list(campaignId)).find((r) => r.key === key);
    const member = campaign.members.find((m) => m.userId === userId);
    const compiled = await this.compiledFor(campaign);
    let gmChange: { fieldIds: string[]; count: number } | undefined;

    // O Mestre alterou a ficha: grava na ficha local o que for válido para o sistema.
    const applyGmChanges = async (changes: RemoteChanges) => {
      const accepted = compiled ? acceptedChanges(compiled, changes) : {};
      const fieldIds = Object.keys(accepted);
      if (fieldIds.length === 0) return;
      await this.sheets.update(sheetId, { values: accepted, updatedAt: this.clock.now() });
      gmChange = { fieldIds, count: (gmChange?.count ?? 0) + 1 };
      publish();
    };

    const client = new SessionClient(
      this.transportFor(campaign),
      { id: campaign.id, gmId: campaign.gmId },
      { userId, displayName: member?.displayName ?? 'Jogador' },
      withoutSecrets(sheet, compiled),
      saved?.state,
      {
        onRemoteChange: (changes) => {
          applyGmChanges(changes).catch((error: unknown) =>
            console.error('Falha ao gravar alteração do Mestre', error),
          );
        },
        onRolls: (entries) => this.recordRolls(campaignId, entries),
      },
    );

    const publish = () =>
      this.setSnapshot({
        kind: 'jogador',
        campaignId,
        sheetId,
        status: client.status(),
        connectionFailures: client.connectionFailures(),
        ...(gmChange && { gmChange }),
      });
    const unsubscribe = client.subscribe(publish);

    // Cada alteração na ficha local (feita em qualquer tela) segue para o Mestre.
    const watch: Subscription = liveQuery(() => this.sheets.get(sheetId)).subscribe({
      next: (current) => {
        if (!current) return;
        client.update(withoutSecrets(current, compiled));
        this.scheduleSave();
      },
    });

    const save = () =>
      this.states.save([
        { campaignId, key, state: client.exportState(), updatedAt: this.clock.now() },
      ]);

    this.active = {
      save,
      stop: async () => {
        watch.unsubscribe();
        unsubscribe();
        await client.stop();
      },
      campaignId,
      author: { id: userId, name: member?.displayName ?? 'Jogador' },
      shareRoll: (entry) => {
        client.roll(entry);
      },
    };
    client.start();
    publish();
    return ok(undefined);
  }

  /**
   * O Mestre altera um campo da ficha de um jogador. Campos secretos ficam só neste
   * aparelho; os demais seguem para o jogador (na hora, ou quando ele reconectar).
   */
  async setPlayerValue(
    campaignId: string,
    sheetId: string,
    fieldId: string,
    value: FieldValue,
  ): Promise<Result<void, Issue>> {
    const campaign = await this.campaigns.get(campaignId);
    const compiled = campaign ? await this.compiledFor(campaign) : undefined;
    const field = compiled?.fieldsById.get(fieldId);
    if (!campaign || !compiled || !field) return failure('campo-ausente', 'Campo inexistente.');
    const problem = valueProblem(field, value);
    if (problem) return failure('valor-invalido', problem);

    if (field.visibility === 'gm') {
      await this.secrets.update(campaignId, sheetId, { [fieldId]: value }, this.clock.now());
      return ok(undefined);
    }
    const snapshot = this.snapshot;
    if (snapshot.kind !== 'mestre' || snapshot.campaignId !== campaignId) {
      return failure('sem-sessao', 'Abra a sessão para alterar as fichas dos jogadores.');
    }
    if (!this.active?.setPlayerValues?.(sheetId, { [fieldId]: value })) {
      return failure('ficha-ausente', 'Esta ficha não faz parte da sessão.');
    }
    return ok(undefined);
  }

  /**
   * Rola dados. Numa sessão, a rolagem entra no registro da campanha e vai para a mesa
   * (a não ser que seja uma rolagem secreta do Mestre); fora dela, só mostra o resultado.
   */
  async roll(input: {
    label: string;
    expression: string;
    secret?: boolean;
  }): Promise<Result<RollEntry, Issue>> {
    const parsed = parseDice(input.expression);
    if (!parsed.ok) return failure(parsed.error.code, parsed.error.message);
    const active = this.active;
    const author = active?.author ?? {
      id: await this.device.getDeviceId(),
      name: (await this.device.getDisplayName()) ?? 'Você',
    };
    const entry: RollEntry = {
      id: this.newId(),
      at: this.clock.now(),
      authorId: author.id,
      authorName: author.name,
      label: input.label.slice(0, 120),
      result: rollDice(parsed.value, this.dieRoller),
      // Só o Mestre rola em segredo.
      secret: input.secret === true && this.snapshot.kind === 'mestre',
    };
    if (active) {
      active.shareRoll(entry);
      await this.rollLog.add(active.campaignId, [entry]);
    }
    return ok(entry);
  }

  /** Registro de rolagens de uma campanha, da mais antiga para a mais recente. */
  rolls(campaignId: string): Promise<RollEntry[]> {
    return this.rollLog.list(campaignId);
  }

  /** Avisa quando chega uma rolagem de outra pessoa da mesa. */
  onRoll(listener: (entry: RollEntry) => void): () => void {
    this.rollListeners.add(listener);
    return () => this.rollListeners.delete(listener);
  }

  /** Rolagens de outros participantes: entram no registro e avisam a interface. */
  private recordRolls(campaignId: string, entries: readonly RollEntry[]): void {
    void this.rollLog.add(campaignId, entries).then(
      () => {
        for (const entry of entries) for (const listener of this.rollListeners) listener(entry);
      },
      (error: unknown) => console.error('Falha ao registrar rolagem', error),
    );
  }

  /** Valores secretos de uma ficha de jogador (só no aparelho do Mestre). */
  async secretValues(campaignId: string, sheetId: string): Promise<Record<string, FieldValue>> {
    return (await this.secrets.get(campaignId, sheetId))?.values ?? {};
  }

  private async compiledFor(campaign: Campaign): Promise<CompiledTemplate | undefined> {
    const template = await this.catalog.get(campaign.templateRef.id);
    return template ? this.catalog.compile(template) : undefined;
  }

  /**
   * Pede ao Mestre o sistema da campanha e o instala. Funciona quando o Mestre está com a
   * sessão aberta; espera por ele até o tempo limite.
   */
  async receiveTemplate(campaignId: string, signal?: AbortSignal): Promise<TemplateReceipt> {
    const campaign = await this.campaigns.get(campaignId);
    if (!campaign) return { ok: false, reason: 'campanha-ausente' };
    const result = await fetchTemplate(this.transportFor(campaign), {
      campaign: { id: campaign.id, gmId: campaign.gmId },
      templateId: campaign.templateRef.id,
      ...(signal ? { signal } : {}),
    });
    if (!result.ok) return result;
    return this.files.installTemplate(result.template);
  }

  /** Encerra a sessão atual, salvando o estado para continuar depois. */
  async stop(): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.active = null;
    clearTimeout(this.saveTimer);
    await active.save();
    await active.stop();
    this.setSnapshot(IDLE);
  }

  /** Salva já o estado pendente (ex.: a aba vai ser fechada). */
  async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    await this.active?.save();
  }

  private transportFor(campaign: Campaign): SyncTransport {
    return this.createTransport({ roomId: campaign.id, secret: campaign.secret });
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.active
        ?.save()
        .catch((error: unknown) => console.error('Falha ao salvar a sessão', error));
    }, SAVE_DELAY);
  }

  private setSnapshot(next: LiveSession): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

const failure = (code: string, message: string): { ok: false; error: Issue } =>
  err({ code, path: [], message });

const isSecret = (compiled: CompiledTemplate | undefined, fieldId: string) =>
  compiled?.fieldsById.get(fieldId)?.visibility === 'gm';

/** A ficha como o Mestre deve recebê-la: sem os campos secretos (que só ele preenche). */
function withoutSecrets(sheet: CharacterSheet, compiled: CompiledTemplate | undefined) {
  if (!compiled?.template.fields.some((f) => f.visibility === 'gm')) return sheet;
  const values = Object.fromEntries(
    Object.entries(sheet.values).filter(([fieldId]) => !isSecret(compiled, fieldId)),
  );
  return { ...sheet, values };
}

/**
 * Alterações do Mestre aceitas na ficha local: campos do sistema, não secretos, com valor
 * válido para o tipo do campo. O resto é ignorado (o conteúdo veio da rede).
 */
function acceptedChanges(
  compiled: CompiledTemplate,
  changes: RemoteChanges,
): Record<string, FieldValue> {
  const accepted: Record<string, FieldValue> = {};
  for (const [fieldId, value] of Object.entries(changes)) {
    const field = compiled.fieldsById.get(fieldId);
    if (!field || field.type === 'computed' || field.visibility === 'gm') continue;
    if (valueProblem(field, value) === undefined) accepted[fieldId] = value;
  }
  return accepted;
}
