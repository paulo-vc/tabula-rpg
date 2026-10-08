import { FieldValueSchema, type CharacterSheet, type FieldValue } from '@tabula/domain';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  decodeMessage,
  encodeHello,
  PROTOCOL_VERSION,
  syncEncoder,
  type Hello,
  type Reject,
} from './protocol';
import { reconcile, VALUES } from './sheet-doc';
import type { SyncTransport } from './transport';

export type ClientStatus =
  /** Na sala, esperando o Mestre aparecer. */
  | { state: 'procurando-mestre' }
  /** Mestre encontrado, trocando o estado inicial. */
  | { state: 'sincronizando' }
  /** Sincronizado: alterações vão para o Mestre na hora. */
  | { state: 'conectado' }
  /** O Mestre recusou a entrada (ex.: ficha de outro sistema). */
  | { state: 'recusado'; reason: Reject };

export interface ClientCampaign {
  id: string;
  gmId: string;
}

const LOCAL = Symbol('alteração local');

/** Valores alterados pelo Mestre, por ID de campo (já validados quanto ao formato). */
export type RemoteChanges = Record<string, FieldValue>;

/**
 * Lado do jogador. Sincroniza a ficha dele (e só ela) com o Mestre.
 *
 * A ficha local (banco do dispositivo) é a fonte da verdade do jogador: `update()` recebe a
 * versão mais recente, e o documento recebe só a diferença. Para que essas escritas vençam
 * escritas antigas, o documento só é alterado depois de conhecer o estado mais recente:
 * um estado salvo de sessões anteriores, ou o estado do Mestre (após a primeira troca).
 *
 * O Mestre também pode alterar a ficha (Fase 7). Depois que o documento está pronto, o que
 * chega dele é entregue a `onRemoteChange` para gravar na ficha local; antes disso (primeira
 * conexão sem estado salvo), a ficha local prevalece e nada é entregue.
 */
export class SessionClient {
  private readonly doc = new Y.Doc();
  private latest: CharacterSheet;
  private ready: boolean;
  private gmPeer: string | null = null;
  private current: ClientStatus = { state: 'procurando-mestre' };
  private readonly listeners = new Set<() => void>();
  private stopped = false;
  private failures = 0;

  constructor(
    private readonly transport: SyncTransport,
    private readonly campaign: ClientCampaign,
    private readonly me: { userId: string; displayName: string },
    sheet: CharacterSheet,
    savedState?: Uint8Array,
    private readonly onRemoteChange: (changes: RemoteChanges) => void = () => {},
  ) {
    this.latest = sheet;
    this.ready = false;
    if (savedState) {
      try {
        Y.applyUpdate(this.doc, savedState, LOCAL);
        this.ready = true;
        reconcile(this.doc, sheet, LOCAL);
      } catch {
        // Estado salvo corrompido: começa do zero e espera o Mestre.
      }
    }
    this.doc.getMap<unknown>(VALUES).observe((event) => {
      const origin = event.transaction.origin;
      if (origin === LOCAL || !this.ready || this.stopped) return;
      const values = this.doc.getMap<unknown>(VALUES);
      const changes: RemoteChanges = {};
      for (const fieldId of event.keysChanged) {
        if (!values.has(fieldId)) continue; // remoções não apagam nada na ficha local
        const value = FieldValueSchema.safeParse(values.get(fieldId));
        if (value.success) changes[fieldId] = value.data;
      }
      if (Object.keys(changes).length > 0) this.onRemoteChange(changes);
    });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this.gmPeer || this.gmPeer === null || this.stopped) return;
      if (this.current.state === 'recusado') return;
      const message = syncEncoder(this.latest.id);
      syncProtocol.writeUpdate(message, update);
      this.transport.send(this.gmPeer, encoding.toUint8Array(message));
    });
  }

  start(): void {
    this.transport.setHandlers({
      onPeerJoin: (peerId) => this.transport.send(peerId, encodeHello(this.hello())),
      onPeerLeave: (peerId) => {
        if (peerId !== this.gmPeer) return;
        this.gmPeer = null;
        if (this.current.state !== 'recusado') this.setStatus({ state: 'procurando-mestre' });
      },
      onMessage: (peerId, data) => this.receive(peerId, data),
      onConnectionFailure: () => {
        this.failures++;
        for (const listener of this.listeners) listener();
      },
    });
  }

  /**
   * Quantas conexões diretas falharam. Enquanto o Mestre não aparece, um valor maior que
   * zero indica rede restritiva (não adianta só esperar).
   */
  connectionFailures(): number {
    return this.failures;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.gmPeer = null;
    await this.transport.leave();
  }

  status(): ClientStatus {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A ficha local mudou: envia a diferença (ou guarda até a primeira sincronização). */
  update(sheet: CharacterSheet): void {
    this.latest = sheet;
    if (this.ready) reconcile(this.doc, sheet, LOCAL);
  }

  /** Estado do documento, para salvar e continuar numa próxima sessão. */
  exportState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  private hello(): Hello {
    return {
      protocol: PROTOCOL_VERSION,
      role: 'jogador',
      campaignId: this.campaign.id,
      userId: this.me.userId,
      displayName: this.me.displayName,
      sheetId: this.latest.id,
      templateId: this.latest.templateRef.id,
    };
  }

  private receive(peerId: string, data: Uint8Array): void {
    if (this.stopped) return;
    const message = decodeMessage(data);
    if (!message) return;

    if (message.type === 'hello') {
      const { hello } = message;
      // Só aceita como Mestre quem se apresenta com o ID do Mestre desta campanha.
      if (hello.role !== 'mestre' || hello.userId !== this.campaign.gmId) return;
      if (hello.campaignId !== this.campaign.id || this.current.state === 'recusado') return;
      const isNew = this.gmPeer !== peerId;
      this.gmPeer = peerId;
      if (isNew) {
        this.setStatus({ state: this.ready ? 'conectado' : 'sincronizando' });
        const step1 = syncEncoder(this.latest.id);
        syncProtocol.writeSyncStep1(step1, this.doc);
        this.transport.send(peerId, encoding.toUint8Array(step1));
      }
      return;
    }

    if (peerId !== this.gmPeer) return; // estrela: só o Mestre fala com o jogador

    if (message.type === 'reject') {
      this.setStatus({ state: 'recusado', reason: message.reject });
      return;
    }

    if (message.type !== 'sync' || message.sheetId !== this.latest.id) return;
    const reply = syncEncoder(this.latest.id);
    const headerLength = encoding.length(reply);
    let messageType: number;
    try {
      messageType = syncProtocol.readSyncMessage(message.decoder, reply, this.doc, peerId);
    } catch {
      return; // atualização malformada
    }
    if (encoding.length(reply) > headerLength)
      this.transport.send(peerId, encoding.toUint8Array(reply));

    if (messageType === syncProtocol.messageYjsSyncStep2) {
      if (!this.ready) {
        this.ready = true;
        // Agora o documento conhece o estado do Mestre: escrever a diferença vence o antigo.
        reconcile(this.doc, this.latest, LOCAL);
      }
      this.setStatus({ state: 'conectado' });
    }
  }

  private setStatus(status: ClientStatus): void {
    this.current = status;
    for (const listener of this.listeners) listener();
  }
}
