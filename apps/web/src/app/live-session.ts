import {
  BonusSchema,
  type Bonus,
  type ChatMessage,
  type ChatRepository,
  CHAT_TEXT_LIMIT,
  ChatMessageSchema,
  parseChatInput,
  err,
  linkedSheetId,
  ok,
  INITIATIVE_RANGE,
  parseDice,
  updateCombatant,
  publicView,
  TrackerSchema,
  type PublicTracker,
  type Tracker,
  roleOf,
  rollDice,
  valueProblem,
  withCover,
  withGmKey,
  type Cover,
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
  type GmKeyRepository,
  sharedEntries,
  type JournalRepository,
  type Cutscene,
  type ImageRepository,
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
  type GmIdentity,
  type GmKeyPair,
  type HostPlayer,
  type RemoteChanges,
  type SavedSheetState,
  type ConnectionInfo,
  type SyncTransport,
} from '@tabula/sync';
import { liveQuery, type Subscription } from 'dexie';
import type { TemplateCatalog } from './catalog';
import { ensureGmIdentity } from './gm-identity';
import type { FileService, ImportResult } from './files';
import type { Clock } from './sheets';
import { TransportPool, type TransportFactory } from './transport-pool';

export type { TransportFactory };

/** Estado da sessão ao vivo deste dispositivo (no máximo uma por vez). */
export type LiveSession =
  | { kind: 'nenhuma' }
  | {
      kind: 'mestre';
      campaignId: string;
      players: HostPlayer[];
      connectionFailures: number;
      /** Ordem de turno completa (com os ocultos), ou `null` fora de combate. */
      initiative: Tracker | null;
      /** Caminho e latência da conexão com cada jogador online, por ficha. */
      connections: Record<string, ConnectionInfo>;
      /** Imagem que o Mestre está mostrando à mesa (cutscene), ou `null`. */
      cutscene: Cutscene | null;
    }
  | {
      kind: 'jogador';
      campaignId: string;
      sheetId: string;
      /** Este jogador (para reconhecer a própria vez na ordem de turno). */
      userId: string;
      status: ClientStatus;
      connectionFailures: number;
      /** Como o Mestre foi reconhecido (`null` enquanto não há Mestre conectado). */
      gmIdentity: GmIdentity | null;
      /** Tentativas de se passar pelo Mestre (prova inválida) nesta sessão. */
      impersonations: number;
      /** Ordem de turno como o Mestre a mostra (sem os ocultos), ou `null` fora de combate. */
      initiative: PublicTracker | null;
      /** Desde quando procura o Mestre (`null` quando conectado), para mostrar o tempo. */
      searchingSince: number | null;
      /** Quanto levou a última conexão com o Mestre, em ms. */
      connectedInMs: number | null;
      /** Caminho e latência da conexão com o Mestre. */
      connection: ConnectionInfo | null;
      /**
       * Imagem que o Mestre está mostrando (`ready`: já está neste aparelho; `since`: quando
       * chegou, para distinguir a mesma imagem mostrada de novo), ou `null`.
       */
      cutscene: { info: Cutscene; ready: boolean; since: number } | null;
      /** Última alteração feita pelo Mestre na ficha (IDs dos campos), para avisar o jogador. */
      gmChange?: { fieldIds: string[]; count: number };
    };

/** Resultado de pedir o sistema ao Mestre: instalado, recusado pela instalação, ou sem resposta. */
export type TemplateReceipt =
  | ImportResult
  | { ok: false; reason: 'mestre-ausente' | 'falha-de-conexao' | 'cancelado' | 'campanha-ausente' };

/** Pausa antes de salvar o estado da sessão (as alterações chegam em rajadas). */
const SAVE_DELAY = 2000;

const IDLE: LiveSession = { kind: 'nenhuma' };

/** De quanto em quanto tempo medir a conexão (caminho e latência) durante a sessão. */
const MEASURE_EVERY_MS = 5000;

/** Onde a ordem de turno do Mestre fica salva, junto do estado da sessão. */
const INITIATIVE_KEY = 'iniciativa';

/** Lê a ordem de turno salva; qualquer coisa inválida vira "sem combate". */
function readInitiative(bytes: Uint8Array | undefined): Tracker | null {
  if (!bytes) return null;
  try {
    const parsed = TrackerSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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
    /** Só na sessão do Mestre: troca os bônus da ficha de um jogador. */
    setPlayerBonuses?: (sheetId: string, bonuses: Bonus[]) => boolean;
    campaignId: string;
    /** Quem rola nesta sessão (nome exibido no registro). */
    author: { id: string; name: string };
    /** Envia a rolagem à mesa (o Mestre não envia as secretas). */
    shareRoll: (entry: RollEntry) => void;
    /** Envia a mensagem do chat (`false`: sem conexão com o Mestre). */
    shareChat: (message: ChatMessage) => boolean;
    /** Só na sessão do Mestre: troca a ordem de turno. */
    setInitiative?: (tracker: Tracker | null) => void;
    /** Só na sessão do Mestre: mostra uma imagem à mesa (ou fecha, com `null`). */
    setCutscene?: (cutscene: { info: Cutscene; data: Uint8Array } | null) => void;
  } | null = null;
  private readonly rollListeners = new Set<(entry: RollEntry) => void>();
  private readonly ownRollListeners = new Set<(entry: RollEntry) => void>();
  private readonly chatListeners = new Set<(message: ChatMessage) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Mantém a sala aberta um tempo depois de sair, para reentrar na hora. */
  private readonly rooms: TransportPool;

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
    private readonly gmKeys: GmKeyRepository,
    private readonly newGmKey: () => GmKeyPair,
    private readonly journal: JournalRepository,
    private readonly images: ImageRepository,
    private readonly chatLog: ChatRepository,
  ) {
    this.rooms = new TransportPool(createTransport);
  }

  getSnapshot = (): LiveSession => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** O Mestre abre a sessão: os jogadores com o convite podem se conectar. */
  async startAsGameMaster(campaignId: string): Promise<Result<void, Issue>> {
    const stored = await this.campaigns.get(campaignId);
    if (!stored) return failure('campanha-ausente', 'Campanha não encontrada.');
    if (roleOf(stored, await this.device.getDeviceId()) !== 'mestre') {
      return failure('nao-e-mestre', 'Só o Mestre pode iniciar a sessão.');
    }
    const proven = await ensureGmIdentity(
      this.campaigns,
      this.gmKeys,
      this.newGmKey,
      stored,
      this.clock.now(),
    );
    if (!proven.ok) return proven;
    const { campaign, identity } = proven.value;
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
        identity,
        ...(template ? { template } : {}),
      },
      saved,
    );
    host.seedRolls(await this.rollLog.list(campaignId));
    host.seedChat(await this.chatLog.list(campaignId));
    const stopChat = host.onChat((message) => this.recordChat(campaignId, [message]));
    const records = await this.states.list(campaignId);
    let initiative = readInitiative(records.find((r) => r.key === INITIATIVE_KEY)?.state);
    host.setTurnOrder(initiative && publicView(initiative));
    const stopRolls = host.onRoll((entry) => {
      this.recordRolls(campaignId, [entry]);
      // Iniciativa rolada pelo jogador na ficha: entra na ordem de turno (o Mestre corrige,
      // se quiser). Vale para quem já está no combate.
      if (entry.purpose !== 'iniciativa' || !initiative) return;
      const combatant = initiative.combatants.find(
        (c) => c.kind === 'jogador' && c.userId === entry.authorId,
      );
      if (!combatant) return;
      const value = Math.max(-INITIATIVE_RANGE, Math.min(INITIATIVE_RANGE, entry.result.total));
      this.active?.setInitiative?.(
        updateCombatant(initiative, combatant.id, { initiative: value }),
      );
    });

    const publish = () =>
      this.setSnapshot({
        kind: 'mestre',
        campaignId,
        players: host.players(),
        connectionFailures: host.connectionFailures(),
        initiative,
        connections,
        cutscene,
      });
    let cutscene: Cutscene | null = null;
    // Mede a conexão com cada jogador online (caminho e latência), para diagnóstico.
    let connections: Record<string, ConnectionInfo> = {};
    const measure = async () => {
      const next: Record<string, ConnectionInfo> = {};
      for (const player of host.players()) {
        if (!player.online) continue;
        const info = await host.connectionInfo(player.sheetId);
        if (info) next[player.sheetId] = info;
      }
      if (JSON.stringify(next) !== JSON.stringify(connections)) {
        connections = next;
        publish();
      }
    };
    const measuring = setInterval(() => void measure(), MEASURE_EVERY_MS);
    // Diário: cada mudança no banco (nova entrada, compartilhar, apagar) segue para a mesa.
    const journalWatch: Subscription = liveQuery(() => this.journal.list(campaignId)).subscribe({
      next: (entries) => host.setJournal(sharedEntries(entries)),
    });
    // Capa: trocar ou remover na página da campanha segue para a mesa (o motor ignora a mesma).
    host.setCover(campaign.cover ?? null);
    const coverWatch: Subscription = liveQuery(() => this.campaigns.get(campaignId)).subscribe({
      next: (current) => host.setCover(current?.cover ?? null),
    });
    const unsubscribe = host.subscribe(() => {
      publish();
      this.scheduleSave();
    });

    const save = () =>
      this.states.save([
        ...[...host.exportState()].map(([sheetId, entry]) => ({
          campaignId,
          key: `mestre:${sheetId}`,
          userId: entry.userId,
          displayName: entry.displayName,
          state: entry.state,
          updatedAt: this.clock.now(),
        })),
        {
          campaignId,
          key: INITIATIVE_KEY,
          state: new TextEncoder().encode(JSON.stringify(initiative)),
          updatedAt: this.clock.now(),
        },
      ]);

    this.active = {
      save,
      stop: async () => {
        clearInterval(measuring);
        journalWatch.unsubscribe();
        coverWatch.unsubscribe();
        stopRolls();
        stopChat();
        unsubscribe();
        await host.stop();
      },
      setPlayerValues: (sheetId, values) => host.setValues(sheetId, values),
      setPlayerBonuses: (sheetId, bonuses) => host.setBonuses(sheetId, bonuses),
      campaignId,
      author: { id: campaign.gmId, name: campaign.gmName },
      shareRoll: (entry) => host.roll(entry),
      shareChat: (message) => {
        host.chat(message);
        return true;
      },
      setInitiative: (tracker) => {
        initiative = tracker;
        host.setTurnOrder(tracker && publicView(tracker));
        publish();
        this.scheduleSave();
      },
      setCutscene: (next) => {
        cutscene = next?.info ?? null;
        host.setCutscene(cutscene, next?.data);
        publish();
      },
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
    let initiative: PublicTracker | null = null;
    let searchingSince: number | null = this.clock.now();
    let connectedInMs: number | null = null;
    let connection: ConnectionInfo | null = null;
    let cutscene: { info: Cutscene; ready: boolean; since: number } | null = null;

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
      { id: campaign.id, gmId: campaign.gmId, ...(campaign.gmKey && { gmKey: campaign.gmKey }) },
      { userId, displayName: member?.displayName ?? 'Jogador' },
      withoutSecrets(sheet, compiled),
      saved?.state,
      {
        onRemoteChange: (changes) => {
          applyGmChanges(changes).catch((error: unknown) =>
            console.error('Falha ao gravar alteração do Mestre', error),
          );
        },
        // O Mestre mudou os bônus (ex.: uma maldição): grava os que valem para este sistema.
        onRemoteBonuses: (bonuses) => {
          const accepted = compiled ? acceptedBonuses(compiled, bonuses) : [];
          void this.sheets
            .update(sheetId, { bonuses: accepted, updatedAt: this.clock.now() })
            .then(() => {
              const fieldIds = accepted.flatMap((b) => b.targets.map((t) => t.fieldId));
              gmChange = { fieldIds, count: (gmChange?.count ?? 0) + 1 };
              publish();
            })
            .catch((error: unknown) => console.error('Falha ao gravar os bônus do Mestre', error));
        },
        onRolls: (entries) => this.recordRolls(campaignId, entries),
        onChat: (messages) => this.recordChat(campaignId, messages),
        // Capa da campanha: fica neste aparelho, para aparecer mesmo fora da sessão.
        onCover: (cover) => {
          this.saveCover(campaignId, cover).catch((error: unknown) =>
            console.error('Falha ao gravar a capa', error),
          );
        },
        // Diário compartilhado pelo Mestre: fica neste aparelho para ler fora da sessão.
        // Cutscene: a imagem já está aqui? Senão, pede ao Mestre (chega em `onImage`).
        onCutscene: (info) => {
          const since = this.clock.now();
          cutscene = info && { info, ready: false, since };
          publish();
          if (!info) return;
          void this.images.findByHash(campaignId, info.hash).then((stored) => {
            if (cutscene?.info.hash !== info.hash) return;
            if (stored && cutscene) {
              cutscene = { ...cutscene, ready: true };
              publish();
            } else {
              client.requestImage(info.hash);
            }
          });
        },
        onImage: (hash, data) => {
          const info = cutscene?.info;
          if (!info || info.hash !== hash) return;
          const meta = {
            ...info,
            id: hash,
            origin: 'recebida' as const,
            createdAt: this.clock.now(),
          };
          this.images
            .save(campaignId, { meta, data })
            .then(() => {
              if (cutscene?.info.hash !== hash) return;
              cutscene = { ...cutscene, ready: true };
              publish();
            })
            .catch((error: unknown) => console.error('Falha ao guardar a imagem', error));
        },
        onJournalEntry: (entry) => {
          this.journal
            .save(campaignId, entry)
            .catch((error: unknown) => console.error('Falha ao gravar o diário', error));
        },
        onJournalKeep: (ids) => {
          this.journal
            .keepOnly(campaignId, ids)
            .catch((error: unknown) => console.error('Falha ao atualizar o diário', error));
        },
        onTurnOrder: (tracker) => {
          initiative = tracker;
          publish();
        },
        // Campanha da v0.1: a primeira chave provada pelo Mestre passa a ser a da campanha.
        onGmKeyLearned: (gmKey) => {
          this.pinGmKey(campaignId, gmKey).catch((error: unknown) =>
            console.error('Falha ao gravar a chave do Mestre', error),
          );
        },
      },
    );

    const publish = () =>
      this.setSnapshot({
        kind: 'jogador',
        campaignId,
        sheetId,
        userId,
        status: client.status(),
        connectionFailures: client.connectionFailures(),
        gmIdentity: client.identity(),
        initiative,
        impersonations: client.impersonations(),
        searchingSince,
        connectedInMs,
        connection,
        cutscene,
        ...(gmChange && { gmChange }),
      });
    // Tempo até conectar (e reconectar), para o jogador ver o progresso e relatar demoras.
    const unsubscribe = client.subscribe(() => {
      const connected = client.status().state === 'conectado';
      if (connected && searchingSince !== null) {
        connectedInMs = this.clock.now() - searchingSince;
        searchingSince = null;
      } else if (!connected && searchingSince === null) {
        searchingSince = this.clock.now();
        connection = null;
        // Sem o Mestre, a imagem que ele mostrava fecha.
        cutscene = null;
      }
      publish();
    });
    const measuring = setInterval(() => {
      void client.connectionInfo().then((info) => {
        if (JSON.stringify(info) === JSON.stringify(connection)) return;
        connection = info;
        publish();
      });
    }, MEASURE_EVERY_MS);

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
        clearInterval(measuring);
        watch.unsubscribe();
        unsubscribe();
        await client.stop();
      },
      campaignId,
      author: { id: userId, name: member?.displayName ?? 'Jogador' },
      shareRoll: (entry) => {
        client.roll(entry);
      },
      shareChat: (message) => client.chat(message),
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

  /** O Mestre troca os bônus da ficha de um jogador (ex.: aplica uma maldição ou bênção). */
  async setPlayerBonuses(
    campaignId: string,
    sheetId: string,
    bonuses: Bonus[],
  ): Promise<Result<void, Issue>> {
    const campaign = await this.campaigns.get(campaignId);
    const compiled = campaign ? await this.compiledFor(campaign) : undefined;
    if (!compiled) return failure('campanha-ausente', 'Campanha não encontrada.');
    if (bonuses.some((bonus) => !BonusSchema.safeParse(bonus).success)) {
      return failure('bonus-invalido', 'Bônus inválido: confira o nome e os valores.');
    }
    const snapshot = this.snapshot;
    if (snapshot.kind !== 'mestre' || snapshot.campaignId !== campaignId) {
      return failure('sem-sessao', 'Abra a sessão para alterar as fichas dos jogadores.');
    }
    if (!this.active?.setPlayerBonuses?.(sheetId, acceptedBonuses(compiled, bonuses))) {
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
    /** `iniciativa`: o Mestre usa o total na ordem de turno (ver `RollEntry.purpose`). */
    purpose?: 'iniciativa';
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
      ...(input.purpose && { purpose: input.purpose }),
    };
    if (active) {
      active.shareRoll(entry);
      await this.rollLog.add(active.campaignId, [entry]);
    }
    for (const listener of this.ownRollListeners) listener(entry);
    return ok(entry);
  }

  /** Registro de rolagens de uma campanha, da mais antiga para a mais recente. */
  rolls(campaignId: string): Promise<RollEntry[]> {
    return this.rollLog.list(campaignId);
  }

  /** Avisa quando este aparelho rola (pela ficha, pelo painel ou pelo chat; com ou sem sessão). */
  onOwnRoll(listener: (entry: RollEntry) => void): () => void {
    this.ownRollListeners.add(listener);
    return () => this.ownRollListeners.delete(listener);
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

  /**
   * Manda uma mensagem no chat da sessão. Aceita os comandos do chat (`parseChatInput`):
   * `/r 1d20+3` rola dados (a rolagem entra no registro, como as outras) e `/me` descreve uma
   * ação. `character` fala como o personagem (ou um NPC); `to` sussurra a uma pessoa.
   */
  async say(input: {
    text: string;
    character?: string;
    to?: { id: string; name: string };
  }): Promise<Result<ChatMessage | RollEntry, Issue>> {
    const parsed = parseChatInput(input.text);
    if (!parsed) return failure('mensagem-vazia', 'Escreva a mensagem (ou /r 1d20 para rolar).');
    const active = this.active;
    if (!active) return failure('sem-sessao', 'O chat funciona com a sessão aberta.');
    if (parsed.kind === 'rolagem') {
      return this.roll({ label: parsed.label, expression: parsed.expression });
    }
    const character = input.character?.trim().slice(0, 100);
    const kind = parsed.kind === 'acao' ? 'acao' : character ? 'personagem' : 'fala';
    const message: ChatMessage = {
      id: this.newId(),
      at: this.clock.now(),
      authorId: active.author.id,
      authorName: active.author.name,
      kind,
      text: parsed.text.slice(0, CHAT_TEXT_LIMIT),
      ...(character && { character }),
      ...(input.to && { to: input.to.id, toName: input.to.name }),
    };
    if (!ChatMessageSchema.safeParse(message).success) {
      return failure('mensagem-invalida', 'Não foi possível enviar esta mensagem.');
    }
    if (!active.shareChat(message)) {
      return failure('sem-conexao', 'Sem conexão com o Mestre: a mensagem não foi enviada.');
    }
    await this.chatLog.add(active.campaignId, [message]);
    return ok(message);
  }

  /** Chat de uma campanha (o que este aparelho viu), da mais antiga para a mais recente. */
  chat(campaignId: string): Promise<ChatMessage[]> {
    return this.chatLog.list(campaignId);
  }

  /** Avisa quando chega uma mensagem de outra pessoa da mesa. */
  onChat(listener: (message: ChatMessage) => void): () => void {
    this.chatListeners.add(listener);
    return () => this.chatListeners.delete(listener);
  }

  /** Mensagens de outros participantes: ficam no chat da campanha e avisam a interface. */
  private recordChat(campaignId: string, messages: readonly ChatMessage[]): void {
    void this.chatLog.add(campaignId, messages).then(
      () => {
        for (const message of messages)
          for (const listener of this.chatListeners) listener(message);
      },
      (error: unknown) => console.error('Falha ao registrar mensagem', error),
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

  /**
   * O Mestre altera a ordem de turno (iniciar, definir iniciativas, passar a vez,
   * encerrar com `null`). Os jogadores recebem a versão sem os ocultos.
   */
  updateInitiative(
    campaignId: string,
    change: (current: Tracker | null) => Tracker | null,
  ): Result<void, Issue> {
    const snapshot = this.snapshot;
    if (snapshot.kind !== 'mestre' || snapshot.campaignId !== campaignId) {
      return failure('sem-sessao', 'Abra a sessão para conduzir o combate.');
    }
    const next = change(snapshot.initiative);
    if (next !== null && !TrackerSchema.safeParse(next).success) {
      return failure('ordem-invalida', 'Ordem de turno inválida.');
    }
    this.active?.setInitiative?.(next);
    return ok(undefined);
  }

  /** O Mestre mostra uma imagem da galeria à mesa, em tela cheia. */
  async showCutscene(campaignId: string, imageId: string): Promise<Result<void, Issue>> {
    const snapshot = this.snapshot;
    if (snapshot.kind !== 'mestre' || snapshot.campaignId !== campaignId) {
      return failure('sem-sessao', 'Abra a sessão para mostrar imagens à mesa.');
    }
    const image = await this.images.get(campaignId, imageId);
    if (!image) return failure('imagem-ausente', 'Esta imagem não existe mais.');
    const { id: _id, origin: _origin, createdAt: _createdAt, ...info } = image.meta;
    this.active?.setCutscene?.({ info, data: image.data });
    return ok(undefined);
  }

  /** O Mestre fecha a imagem para toda a mesa. */
  hideCutscene(campaignId: string): void {
    const snapshot = this.snapshot;
    if (snapshot.kind === 'mestre' && snapshot.campaignId === campaignId) {
      this.active?.setCutscene?.(null);
    }
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

  /** Grava a capa recebida do Mestre (ou a remove). */
  private async saveCover(campaignId: string, cover: Cover | null): Promise<void> {
    const campaign = await this.campaigns.get(campaignId);
    if (!campaign) return;
    const next = withCover(campaign, cover, this.clock.now());
    if (next !== campaign) await this.campaigns.save(next);
  }

  /** Grava na campanha a chave do Mestre provada na primeira conexão (a primeira prevalece). */
  private async pinGmKey(campaignId: string, gmKey: string): Promise<void> {
    const campaign = await this.campaigns.get(campaignId);
    if (campaign) await this.campaigns.save(withGmKey(campaign, gmKey, this.clock.now()));
  }

  private transportFor(campaign: Campaign): SyncTransport {
    return this.rooms.lease({ roomId: campaign.id, secret: campaign.secret });
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

/**
 * Bônus aceitos numa ficha: só os alvos que são campos de número ou calculados do sistema, e
 * não secretos. Um bônus sem nenhum alvo válido sai (o conteúdo pode ter vindo da rede).
 */
export function acceptedBonuses(compiled: CompiledTemplate, bonuses: readonly Bonus[]): Bonus[] {
  const accepted: Bonus[] = [];
  for (const bonus of bonuses) {
    const targets = bonus.targets.filter(({ fieldId }) => {
      const field = compiled.fieldsById.get(fieldId);
      return (
        field !== undefined &&
        (field.type === 'number' || field.type === 'computed') &&
        field.visibility !== 'gm'
      );
    });
    if (targets.length > 0) accepted.push({ ...bonus, targets });
  }
  return accepted;
}
