import {
  err,
  linkedSheetId,
  ok,
  roleOf,
  type Campaign,
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
  } | null = null;
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
        unsubscribe();
        await host.stop();
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
    const client = new SessionClient(
      this.transportFor(campaign),
      { id: campaign.id, gmId: campaign.gmId },
      { userId, displayName: member?.displayName ?? 'Jogador' },
      sheet,
      saved?.state,
    );

    const publish = () =>
      this.setSnapshot({
        kind: 'jogador',
        campaignId,
        sheetId,
        status: client.status(),
        connectionFailures: client.connectionFailures(),
      });
    const unsubscribe = client.subscribe(publish);

    // Cada alteração na ficha local (feita em qualquer tela) segue para o Mestre.
    const watch: Subscription = liveQuery(() => this.sheets.get(sheetId)).subscribe({
      next: (current) => {
        if (!current) return;
        client.update(current);
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
    };
    client.start();
    publish();
    return ok(undefined);
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
