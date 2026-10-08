import { LIMITS, type FieldValue, type SystemTemplate } from '@tabula/domain';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  decodeMessage,
  encodeHello,
  encodeReject,
  encodeTemplate,
  PROTOCOL_VERSION,
  syncEncoder,
  type Hello,
  type Reject,
} from './protocol';
import { deepEqual, readSheet, VALUES, type SheetSnapshot } from './sheet-doc';
import type { SyncTransport } from './transport';

export interface HostCampaign {
  id: string;
  gmId: string;
  gmName: string;
  templateId: string;
  /** O sistema da campanha, enviado a quem pedir (jogador que ainda não o tem instalado). */
  template?: SystemTemplate;
}

/** Origem das alterações feitas pelo próprio Mestre. */
const GM_EDIT = Symbol('alteração do Mestre');

/** Um jogador da sessão, do ponto de vista do Mestre. */
export interface HostPlayer {
  sheetId: string;
  userId: string;
  displayName: string;
  online: boolean;
  /** Última versão da ficha recebida (`null` se ainda nada válido chegou). */
  sheet: SheetSnapshot | null;
}

/** Estado salvo de uma ficha, para continuar de onde parou numa próxima sessão. */
export interface SavedSheetState {
  userId: string;
  displayName: string;
  state: Uint8Array;
}

interface Entry {
  doc: Y.Doc;
  userId: string;
  displayName: string;
  /** Participante conectado que é o dono da ficha agora, ou `null`. */
  peerId: string | null;
  snapshot: SheetSnapshot | null | undefined; // undefined = recalcular
}

/**
 * Lado do Mestre. Mantém um documento Yjs por ficha de jogador e o sincroniza só com o
 * dono dela. Tudo o que chega é validado; mensagens inválidas são ignoradas.
 */
export class SessionHost {
  private readonly entries = new Map<string, Entry>();
  private readonly sheetOfPeer = new Map<string, string>();
  /** Quem já recebeu o sistema nesta conexão (evita reenviar sem parar a quem insiste). */
  private readonly templateSent = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private stopped = false;
  private failures = 0;

  constructor(
    private readonly transport: SyncTransport,
    private readonly campaign: HostCampaign,
    saved: ReadonlyMap<string, SavedSheetState> = new Map(),
    private readonly maxPlayers: number = LIMITS.members,
  ) {
    for (const [sheetId, { userId, displayName, state }] of saved) {
      const entry = this.createEntry(sheetId, userId, displayName);
      try {
        Y.applyUpdate(entry.doc, state);
      } catch {
        // Estado salvo corrompido: começa vazio; o jogador reenvia tudo ao conectar.
      }
    }
  }

  start(): void {
    this.transport.setHandlers({
      onPeerJoin: (peerId) => this.send(peerId, encodeHello(this.hello())),
      onPeerLeave: (peerId) => {
        this.templateSent.delete(peerId);
        this.detach(peerId);
      },
      onMessage: (peerId, data) => this.receive(peerId, data),
      onConnectionFailure: () => {
        this.failures++;
        this.notify();
      },
    });
  }

  /** Quantas conexões diretas falharam nesta sessão (alguém não conseguiu entrar). */
  connectionFailures(): number {
    return this.failures;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.transport.leave();
    for (const entry of this.entries.values()) entry.peerId = null;
    this.notify();
  }

  /** Jogadores conhecidos nesta sessão (online ou não), na ordem em que chegaram. */
  players(): HostPlayer[] {
    return [...this.entries].map(([sheetId, entry]) => {
      if (entry.snapshot === undefined) {
        const snapshot = readSheet(entry.doc);
        // A ficha precisa ser a anunciada e do jogador que a anunciou.
        entry.snapshot =
          snapshot && snapshot.id === sheetId && snapshot.ownerId === entry.userId
            ? snapshot
            : null;
      }
      return {
        sheetId,
        userId: entry.userId,
        displayName: entry.displayName,
        online: entry.peerId !== null,
        sheet: entry.snapshot,
      };
    });
  }

  /** Avisa quando jogadores entram, saem ou alteram fichas. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * O Mestre altera valores da ficha de um jogador. Seguem na hora se ele estiver online;
   * senão, ficam no documento e chegam quando ele reconectar.
   * @returns `false` se a ficha não é conhecida nesta campanha.
   */
  setValues(sheetId: string, values: Record<string, FieldValue>): boolean {
    const entry = this.entries.get(sheetId);
    if (!entry || this.stopped) return false;
    const map = entry.doc.getMap<unknown>(VALUES);
    entry.doc.transact(() => {
      for (const [fieldId, value] of Object.entries(values)) {
        if (!deepEqual(map.get(fieldId), value)) map.set(fieldId, value);
      }
    }, GM_EDIT);
    return true;
  }

  /** Estado das fichas para salvar e continuar numa próxima sessão. */
  exportState(): Map<string, SavedSheetState> {
    return new Map(
      [...this.entries].map(([sheetId, entry]) => [
        sheetId,
        {
          userId: entry.userId,
          displayName: entry.displayName,
          state: Y.encodeStateAsUpdate(entry.doc),
        },
      ]),
    );
  }

  private hello(): Hello {
    return {
      protocol: PROTOCOL_VERSION,
      role: 'mestre',
      campaignId: this.campaign.id,
      userId: this.campaign.gmId,
      displayName: this.campaign.gmName,
    };
  }

  private receive(peerId: string, data: Uint8Array): void {
    if (this.stopped) return;
    const message = decodeMessage(data);
    if (!message) return;
    if (message.type === 'hello' && message.hello.role === 'jogador') {
      this.admit(peerId, message.hello);
    } else if (message.type === 'template-request') {
      const { template } = this.campaign;
      const { request } = message;
      if (!template || this.templateSent.has(peerId)) return;
      if (request.campaignId !== this.campaign.id || request.templateId !== template.id) return;
      this.templateSent.add(peerId);
      this.send(peerId, encodeTemplate(template));
    } else if (message.type === 'sync') {
      const sheetId = this.sheetOfPeer.get(peerId);
      const entry = sheetId === undefined ? undefined : this.entries.get(sheetId);
      // Só o dono atual da ficha sincroniza esta ficha.
      if (!entry || message.sheetId !== sheetId) return;
      const reply = syncEncoder(sheetId);
      const headerLength = encoding.length(reply);
      try {
        syncProtocol.readSyncMessage(message.decoder, reply, entry.doc, peerId);
      } catch {
        return; // atualização Yjs malformada
      }
      if (encoding.length(reply) > headerLength) this.send(peerId, encoding.toUint8Array(reply));
    }
  }

  private admit(peerId: string, hello: Extract<Hello, { role: 'jogador' }>): void {
    const reject = (code: Reject['code'], message: string) =>
      this.send(peerId, encodeReject({ code, message }));

    if (hello.campaignId !== this.campaign.id) {
      return reject('campanha-diferente', 'Este convite é de outra campanha.');
    }
    if (hello.userId === this.campaign.gmId) return; // ninguém entra como jogador com o ID do Mestre
    if (hello.templateId !== this.campaign.templateId) {
      return reject('sistema-diferente', 'A ficha não é do sistema desta campanha.');
    }
    const existing = this.entries.get(hello.sheetId);
    if (existing && existing.userId !== hello.userId) {
      return reject('ficha-de-outro', 'Esta ficha pertence a outro jogador da campanha.');
    }
    const online = new Set(this.sheetOfPeer.values()).size;
    if (!existing && online >= this.maxPlayers) {
      return reject('sala-cheia', 'A sessão atingiu o limite de jogadores.');
    }

    // O participante trocou de ficha: solta a anterior.
    const previous = this.sheetOfPeer.get(peerId);
    if (previous !== undefined && previous !== hello.sheetId) this.detach(peerId);

    const entry = existing ?? this.createEntry(hello.sheetId, hello.userId, hello.displayName);
    // O mesmo jogador reconectando (outra aba, rede trocada): a conexão mais nova assume.
    if (entry.peerId !== null && entry.peerId !== peerId) this.sheetOfPeer.delete(entry.peerId);
    entry.peerId = peerId;
    entry.displayName = hello.displayName;
    this.sheetOfPeer.set(peerId, hello.sheetId);

    this.send(peerId, encodeHello(this.hello()));
    const step1 = syncEncoder(hello.sheetId);
    syncProtocol.writeSyncStep1(step1, entry.doc);
    this.send(peerId, encoding.toUint8Array(step1));
    this.notify();
  }

  private createEntry(sheetId: string, userId: string, displayName: string): Entry {
    const entry: Entry = {
      doc: new Y.Doc(),
      userId,
      displayName,
      peerId: null,
      snapshot: undefined,
    };
    entry.doc.on('update', (update: Uint8Array, origin: unknown) => {
      entry.snapshot = undefined;
      // Alterações do Mestre (e de estados salvos) seguem para o dono da ficha.
      if (entry.peerId !== null && origin !== entry.peerId) {
        const message = syncEncoder(sheetId);
        syncProtocol.writeUpdate(message, update);
        this.send(entry.peerId, encoding.toUint8Array(message));
      }
      this.notify();
    });
    this.entries.set(sheetId, entry);
    return entry;
  }

  private detach(peerId: string): void {
    const sheetId = this.sheetOfPeer.get(peerId);
    if (sheetId === undefined) return;
    this.sheetOfPeer.delete(peerId);
    const entry = this.entries.get(sheetId);
    if (entry?.peerId === peerId) entry.peerId = null;
    this.notify();
  }

  private send(peerId: string, data: Uint8Array): void {
    if (!this.stopped) this.transport.send(peerId, data);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
