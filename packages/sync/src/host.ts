import {
  canSee,
  CHAT_CATCH_UP,
  CHAT_LIMIT,
  type ChatMessage,
  LIMITS,
  LOG_CATCH_UP,
  type FieldValue,
  type JournalEntry,
  type Cutscene,
  type PublicTracker,
  type RollEntry,
  type SystemTemplate,
} from '@tabula/domain';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { signChallenge, type GmKeyPair } from './identity';
import { chunkImage } from './image-transfer';
import {
  decodeMessage,
  encodeHello,
  encodeLog,
  encodeReject,
  encodeTemplate,
  encodeTurn,
  encodeBye,
  encodeChat,
  encodeJournalKeep,
  encodeJournalPut,
  encodeCutscene,
  encodeImagePart,
  PROTOCOL_VERSION,
  syncEncoder,
  type Hello,
  type Reject,
} from './protocol';
import { deepEqual, readSheet, VALUES, type SheetSnapshot } from './sheet-doc';
import type { ConnectionInfo, SyncTransport } from './transport';

export interface HostCampaign {
  id: string;
  gmId: string;
  gmName: string;
  templateId: string;
  /** O sistema da campanha, enviado a quem pedir (jogador que ainda não o tem instalado). */
  template?: SystemTemplate;
  /**
   * Par de chaves do Mestre. Com ele, o Mestre prova sua identidade a cada jogador
   * (desafio-resposta). Sem ele (campanhas da v0.1), apenas se declara.
   */
  identity?: GmKeyPair;
}

/** Quantas vezes um participante pode pedir a mesma imagem numa conexão. */
const MAX_IMAGE_REQUESTS = 3;

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
  private readonly rollListeners = new Set<(entry: RollEntry) => void>();
  private readonly chatListeners = new Set<(message: ChatMessage) => void>();
  /** Mensagens recentes do chat (com os sussurros), para quem entra no meio da sessão. */
  private recentChat: ChatMessage[] = [];
  /** Rolagens públicas recentes, enviadas a quem entra no meio da sessão. */
  private recentRolls: RollEntry[] = [];
  /** Ordem de turno atual (versão pública), enviada também a quem entra no meio do combate. */
  private turnOrder: PublicTracker | null = null;
  /** Entradas do diário compartilhadas com a mesa (por ID), já enviadas aos online. */
  private journal = new Map<string, JournalEntry>();
  /** Imagem mostrada à mesa agora (e o conteúdo, enviado a quem pedir). */
  private cutscene: { info: Cutscene; data: Uint8Array } | null = null;
  /** Quantas vezes cada participante pediu a imagem atual (contra pedidos sem fim). */
  private readonly imageRequests = new Map<string, number>();
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
    // Avisa a saída: a conexão pode continuar aberta (o app mantém a sala por um tempo).
    const bye = encodeBye();
    for (const peerId of this.sheetOfPeer.keys()) this.transport.send(peerId, bye);
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

  /** Caminho e latência da conexão com o dono de uma ficha (`null` se offline ou sem medida). */
  async connectionInfo(sheetId: string): Promise<ConnectionInfo | null> {
    const peerId = this.entries.get(sheetId)?.peerId;
    if (!peerId || this.stopped || !this.transport.connectionInfo) return null;
    return this.transport.connectionInfo(peerId);
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

  /** Rolagens recentes de sessões anteriores (para quem entrar receber o contexto). */
  seedRolls(entries: readonly RollEntry[]): void {
    this.recentRolls = entries.filter((entry) => !entry.secret).slice(-LOG_CATCH_UP);
  }

  /**
   * Rolagem do Mestre. Pública: vai para todos os jogadores online. Secreta: não sai
   * deste aparelho.
   */
  roll(entry: RollEntry): void {
    if (entry.secret || this.stopped) return;
    this.remember(entry);
    this.broadcast(entry, null);
  }

  /**
   * Atualiza a ordem de turno da mesa (`null` encerra o combate). Recebe só a versão
   * pública: participantes ocultos nunca chegam a este motor.
   */
  setTurnOrder(view: PublicTracker | null): void {
    if (this.stopped) return;
    this.turnOrder = view;
    const message = encodeTurn(view);
    for (const peerId of this.sheetOfPeer.keys()) this.send(peerId, message);
  }

  /**
   * Atualiza as entradas do diário compartilhadas com a mesa. Envia aos jogadores online só
   * o que mudou (e a lista das que continuam, para apagarem as outras). Recebe só as
   * compartilhadas: as notas do Mestre nunca chegam a este motor.
   */
  setJournal(entries: readonly JournalEntry[]): void {
    if (this.stopped) return;
    const next = new Map(entries.filter((e) => e.shared).map((e) => [e.id, e]));
    const changed = [...next.values()].filter(
      (entry) => this.journal.get(entry.id)?.updatedAt !== entry.updatedAt,
    );
    const removed = [...this.journal.keys()].some((id) => !next.has(id));
    this.journal = next;
    for (const peerId of this.sheetOfPeer.keys()) {
      if (removed) this.send(peerId, encodeJournalKeep([...next.keys()]));
      for (const entry of changed) this.send(peerId, encodeJournalPut(entry));
    }
  }

  /**
   * Mostra uma imagem à mesa em tela cheia (`null` fecha). O conteúdo só vai a quem pedir
   * (quem ainda não tem a imagem) e só o da imagem mostrada: ninguém baixa o resto da galeria.
   */
  setCutscene(info: Cutscene | null, data?: Uint8Array): void {
    if (this.stopped) return;
    this.cutscene = info && data ? { info, data } : null;
    this.imageRequests.clear();
    const message = encodeCutscene(this.cutscene?.info ?? null);
    for (const peerId of this.sheetOfPeer.keys()) this.send(peerId, message);
  }

  /** Mensagens do chat de sessões anteriores (para quem entrar receber o contexto). */
  seedChat(messages: readonly ChatMessage[]): void {
    this.recentChat = messages.slice(-CHAT_LIMIT);
  }

  /**
   * Mensagem do Mestre no chat: vai para a mesa toda ou, num sussurro (`to`), só para
   * aquele jogador.
   */
  chat(message: ChatMessage): void {
    if (this.stopped || message.authorId !== this.campaign.gmId) return;
    this.rememberChat(message);
    this.deliverChat(message, null);
  }

  /** Avisa quando chega uma mensagem de um jogador (já conferida e repassada). */
  onChat(listener: (message: ChatMessage) => void): () => void {
    this.chatListeners.add(listener);
    return () => this.chatListeners.delete(listener);
  }

  private rememberChat(message: ChatMessage): void {
    this.recentChat = [...this.recentChat, message].slice(-CHAT_LIMIT);
  }

  /**
   * Envia a mensagem a quem pode vê-la, exceto `except` (quem a mandou): a mesa toda, ou só
   * o destinatário do sussurro. Sussurros para o Mestre não saem daqui.
   */
  private deliverChat(message: ChatMessage, except: string | null): void {
    const data = encodeChat([message]);
    for (const [peerId, sheetId] of this.sheetOfPeer) {
      const userId = this.entries.get(sheetId)?.userId;
      if (peerId === except || userId === undefined || !canSee(message, userId)) continue;
      this.send(peerId, data);
    }
  }

  private receiveChat(peerId: string, messages: ChatMessage[]): void {
    const sheetId = this.sheetOfPeer.get(peerId);
    const entry = sheetId === undefined ? undefined : this.entries.get(sheetId);
    if (!entry) return;
    const known = new Set(this.recentChat.map((message) => message.id));
    for (const message of messages) {
      // Cada jogador só manda mensagens próprias (com o nome com que entrou), novas, e
      // sussurra só ao Mestre (entre jogadores, ainda não).
      if (message.authorId !== entry.userId || message.authorName !== entry.displayName) continue;
      if (known.has(message.id)) continue;
      if (message.to !== undefined && message.to !== this.campaign.gmId) continue;
      known.add(message.id);
      this.rememberChat(message);
      this.deliverChat(message, peerId);
      for (const listener of this.chatListeners) listener(message);
    }
  }

  /** Avisa quando um jogador rola (a rolagem já foi validada e repassada à mesa). */
  onRoll(listener: (entry: RollEntry) => void): () => void {
    this.rollListeners.add(listener);
    return () => this.rollListeners.delete(listener);
  }

  private remember(entry: RollEntry): void {
    this.recentRolls = [...this.recentRolls, entry].slice(-LOG_CATCH_UP);
  }

  /** Envia a rolagem a todos os jogadores online, exceto `except` (quem rolou). */
  private broadcast(entry: RollEntry, except: string | null): void {
    const message = encodeLog([entry]);
    for (const peerId of this.sheetOfPeer.keys()) {
      if (peerId !== except) this.send(peerId, message);
    }
  }

  private receiveRolls(peerId: string, entries: RollEntry[]): void {
    const sheetId = this.sheetOfPeer.get(peerId);
    const entry = sheetId === undefined ? undefined : this.entries.get(sheetId);
    if (!entry) return;
    const known = new Set(this.recentRolls.map((roll) => roll.id));
    for (const roll of entries) {
      // Cada jogador só registra rolagens próprias, públicas e novas.
      if (roll.authorId !== entry.userId || roll.secret || known.has(roll.id)) continue;
      known.add(roll.id);
      this.remember(roll);
      this.broadcast(roll, peerId);
      for (const listener of this.rollListeners) listener(roll);
    }
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

  /**
   * Apresentação do Mestre. Com `challenge` (o desafio do jogador) e uma identidade, vai
   * assinada; sem eles, é só uma declaração, que jogadores com a chave do Mestre ignoram.
   */
  private hello(challenge?: string): Hello {
    const { identity } = this.campaign;
    return {
      protocol: PROTOCOL_VERSION,
      role: 'mestre',
      campaignId: this.campaign.id,
      userId: this.campaign.gmId,
      displayName: this.campaign.gmName,
      ...(identity &&
        challenge !== undefined && {
          gmKey: identity.publicKey,
          proof: signChallenge(identity.secretKey, this.campaign.id, challenge, this.campaign.gmId),
        }),
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
    } else if (message.type === 'image-request') {
      this.sendImage(peerId, message.hash);
    } else if (message.type === 'bye') {
      this.templateSent.delete(peerId);
      this.detach(peerId);
    } else if (message.type === 'log') {
      this.receiveRolls(peerId, message.entries);
    } else if (message.type === 'chat') {
      this.receiveChat(peerId, message.messages);
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

    if (hello.userId === this.campaign.gmId) return; // ninguém entra como jogador com o ID do Mestre
    // A prova de identidade vem antes de qualquer resposta: o jogador só dá ouvidos (inclusive
    // a recusas) a um Mestre autenticado. O HELLO pode se repetir; reenviar é inofensivo.
    this.send(peerId, encodeHello(this.hello(hello.challenge)));

    if (hello.campaignId !== this.campaign.id) {
      return reject('campanha-diferente', 'Este convite é de outra campanha.');
    }
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
    const firstHello = entry.peerId !== peerId;
    // O mesmo jogador reconectando (outra aba, rede trocada): a conexão mais nova assume.
    if (entry.peerId !== null && entry.peerId !== peerId) this.sheetOfPeer.delete(entry.peerId);
    entry.peerId = peerId;
    entry.displayName = hello.displayName;
    this.sheetOfPeer.set(peerId, hello.sheetId);

    const step1 = syncEncoder(hello.sheetId);
    syncProtocol.writeSyncStep1(step1, entry.doc);
    this.send(peerId, encoding.toUint8Array(step1));
    // O HELLO pode se repetir (o transporte reanuncia quem já está conectado): o histórico
    // vai uma vez por conexão.
    if (firstHello && this.recentRolls.length > 0) this.send(peerId, encodeLog(this.recentRolls));
    if (firstHello) {
      // A conversa recente que este jogador pode ver (a mesa e os sussurros dele).
      const visible = this.recentChat
        .filter((message) => canSee(message, hello.userId))
        .slice(-CHAT_CATCH_UP);
      if (visible.length > 0) this.send(peerId, encodeChat(visible));
    }
    if (firstHello && this.turnOrder) this.send(peerId, encodeTurn(this.turnOrder));
    if (firstHello && this.cutscene) this.send(peerId, encodeCutscene(this.cutscene.info));
    if (firstHello) {
      // O diário inteiro a quem chega: a lista das que valem e cada entrada.
      this.send(peerId, encodeJournalKeep([...this.journal.keys()]));
      for (const entry of this.journal.values()) this.send(peerId, encodeJournalPut(entry));
    }
    this.notify();
  }

  /** Envia a imagem da cutscene, em partes, a um jogador da sessão que a pediu. */
  private sendImage(peerId: string, hash: string): void {
    const current = this.cutscene;
    if (!current || current.info.hash !== hash || !this.sheetOfPeer.has(peerId)) return;
    const asked = (this.imageRequests.get(peerId) ?? 0) + 1;
    if (asked > MAX_IMAGE_REQUESTS) return;
    this.imageRequests.set(peerId, asked);
    const parts = chunkImage(current.data);
    parts.forEach((part, index) =>
      this.send(peerId, encodeImagePart(hash, index, parts.length, part)),
    );
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
