import {
  canSee,
  type ChatMessage,
  type Cover,
  FieldValueSchema,
  type CharacterSheet,
  type FieldValue,
  type JournalEntry,
  type Cutscene,
  type PublicTracker,
  type RollEntry,
} from '@tabula/domain';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  decodeMessage,
  encodeHello,
  encodeLog,
  encodeBye,
  encodeChat,
  encodeImageRequest,
  PROTOCOL_VERSION,
  syncEncoder,
  type Hello,
  type Reject,
} from './protocol';
import { newChallenge, verifyChallenge } from './identity';
import { ImageAssembler } from './image-transfer';
import { reconcile, VALUES } from './sheet-doc';
import type { ConnectionInfo, SyncTransport } from './transport';

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
  /**
   * Chave pública do Mestre (do convite). Com ela, só é Mestre quem provar que a possui.
   * Sem ela (campanha da v0.1), a primeira chave provada é fixada (`onGmKeyLearned`).
   */
  gmKey?: string;
}

/**
 * Como o Mestre foi reconhecido nesta conexão:
 * - `verificada`: provou possuir a chave do Mestre;
 * - `declarada`: apenas se apresentou com o ID dele (Mestre de uma versão sem assinatura).
 */
export type GmIdentity = 'verificada' | 'declarada';

const LOCAL = Symbol('alteração local');

/** Valores alterados pelo Mestre, por ID de campo (já validados quanto ao formato). */
export type RemoteChanges = Record<string, FieldValue>;

export interface ClientCallbacks {
  /** O Mestre alterou valores da ficha (Fase 7a). */
  onRemoteChange?: (changes: RemoteChanges) => void;
  /** Rolagens da mesa chegaram (de outros jogadores, do Mestre ou do histórico recente). */
  onRolls?: (entries: RollEntry[]) => void;
  /** Mensagens do chat chegaram (da mesa, sussurros do Mestre ou o histórico recente). */
  onChat?: (messages: ChatMessage[]) => void;
  /** A capa da campanha (`null`: o Mestre não tem ou removeu). */
  onCover?: (cover: Cover | null) => void;
  /** A ordem de turno do combate mudou (`null`: o Mestre encerrou o combate). */
  onTurnOrder?: (tracker: PublicTracker | null) => void;
  /** O Mestre compartilhou (ou alterou) uma entrada do diário. */
  onJournalEntry?: (entry: JournalEntry) => void;
  /** As entradas que continuam compartilhadas: as outras devem ser apagadas. */
  onJournalKeep?: (ids: string[]) => void;
  /** O Mestre mostrou uma imagem à mesa (`null`: fechou). */
  onCutscene?: (cutscene: Cutscene | null) => void;
  /** Chegou, completa e conferida, a imagem pedida com `requestImage`. */
  onImage?: (hash: string, data: Uint8Array) => void;
  /** Campanha sem chave do Mestre: a primeira provada foi fixada e deve ser gravada. */
  onGmKeyLearned?: (gmKey: string) => void;
}

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
  private gmIdentity: GmIdentity | null = null;
  /** Chave do Mestre conhecida: a do convite ou a fixada na primeira prova. */
  private gmKey: string | undefined;
  /** Desafio desta conexão; a prova do Mestre só vale para ele (impede reaproveitar provas). */
  private readonly challenge = newChallenge();
  /** Participantes a quem o desafio já foi reenviado nesta conexão (ver `receive`). */
  private readonly challenged = new Set<string>();
  /** Cutscene atual (para saber qual imagem aceitar) e a imagem sendo recebida. */
  private cutscene: Cutscene | null = null;
  private assembler: ImageAssembler | null = null;
  private current: ClientStatus = { state: 'procurando-mestre' };
  private readonly listeners = new Set<() => void>();
  private stopped = false;
  private failures = 0;
  private forgeries = 0;

  constructor(
    private readonly transport: SyncTransport,
    private readonly campaign: ClientCampaign,
    private readonly me: { userId: string; displayName: string },
    sheet: CharacterSheet,
    savedState?: Uint8Array,
    private readonly callbacks: ClientCallbacks = {},
  ) {
    this.latest = sheet;
    this.ready = false;
    this.gmKey = campaign.gmKey;
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
      if (Object.keys(changes).length > 0) this.callbacks.onRemoteChange?.(changes);
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
        this.challenged.delete(peerId);
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
    // Avisa a saída: a conexão pode continuar aberta (o app mantém a sala por um tempo).
    if (this.gmPeer !== null) this.transport.send(this.gmPeer, encodeBye());
    this.stopped = true;
    this.gmPeer = null;
    await this.transport.leave();
  }

  /**
   * Pede ao Mestre a imagem da cutscene atual (quem ainda não a tem). Só vale para a imagem
   * mostrada agora; ela chega em `onImage`, conferida.
   */
  requestImage(hash: string): void {
    if (this.gmPeer === null || this.stopped || this.cutscene?.hash !== hash) return;
    this.assembler = new ImageAssembler(this.cutscene);
    this.transport.send(this.gmPeer, encodeImageRequest(hash));
  }

  /** Caminho e latência da conexão com o Mestre (`null` sem Mestre ou sem medida). */
  async connectionInfo(): Promise<ConnectionInfo | null> {
    if (this.gmPeer === null || this.stopped || !this.transport.connectionInfo) return null;
    return this.transport.connectionInfo(this.gmPeer);
  }

  status(): ClientStatus {
    return this.current;
  }

  /**
   * Quantas vezes alguém se apresentou como Mestre com uma prova inválida (chave errada
   * ou assinatura que não confere). Indica tentativa de se passar por ele.
   */
  impersonations(): number {
    return this.forgeries;
  }

  /** Como o Mestre atual foi reconhecido (`null` enquanto não há Mestre). */
  identity(): GmIdentity | null {
    return this.gmPeer === null ? null : this.gmIdentity;
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

  /**
   * Envia uma rolagem ao Mestre, que a repassa à mesa.
   * @returns `false` se não está conectado (a rolagem fica só neste aparelho).
   */
  roll(entry: RollEntry): boolean {
    if (this.gmPeer === null || this.current.state !== 'conectado' || this.stopped) return false;
    this.transport.send(this.gmPeer, encodeLog([entry]));
    return true;
  }

  /**
   * Envia uma mensagem do chat ao Mestre, que a repassa à mesa (ou só a lê, num sussurro).
   * @returns `false` se não está conectado.
   */
  chat(message: ChatMessage): boolean {
    if (this.gmPeer === null || this.current.state !== 'conectado' || this.stopped) return false;
    this.transport.send(this.gmPeer, encodeChat([message]));
    return true;
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
      challenge: this.challenge,
    };
  }

  private receive(peerId: string, data: Uint8Array): void {
    if (this.stopped) return;
    const message = decodeMessage(data);
    if (!message) return;

    if (message.type === 'hello') {
      const { hello } = message;
      if (hello.role !== 'mestre' || hello.userId !== this.campaign.gmId) return;
      if (hello.campaignId !== this.campaign.id || this.current.state === 'recusado') return;
      const identity = this.authenticate(hello);
      if (identity === null) {
        // Apresentou-se como Mestre sem prova. O primeiro HELLO deste jogador (com o
        // desafio) pode ter se perdido: o Mestre entrou na sala antes de começar a escutar,
        // como ao recarregar a página. Reenvia o desafio, uma vez por conexão; o Mestre
        // verdadeiro responde com a prova, e um impostor continua sem conseguir.
        if (hello.proof === undefined && !this.challenged.has(peerId)) {
          this.challenged.add(peerId);
          this.transport.send(peerId, encodeHello(this.hello()));
        }
        return;
      }
      const isNew = this.gmPeer !== peerId;
      // Uma prova válida vale mais que uma simples declaração anterior.
      if (isNew || identity === 'verificada') {
        this.gmPeer = peerId;
        this.gmIdentity = identity;
      }
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

    if (message.type === 'bye') {
      // O Mestre encerrou a sessão (a conexão pode continuar aberta).
      this.gmPeer = null;
      this.challenged.delete(peerId);
      if (this.current.state !== 'recusado') this.setStatus({ state: 'procurando-mestre' });
      return;
    }

    if (message.type === 'log') {
      this.callbacks.onRolls?.(message.entries);
      return;
    }

    if (message.type === 'cover') {
      this.callbacks.onCover?.(message.cover);
      return;
    }

    if (message.type === 'chat') {
      // Só o que este jogador pode ver (o Mestre já filtra; aqui, por garantia).
      const visible = message.messages.filter((m) => canSee(m, this.me.userId));
      if (visible.length > 0) this.callbacks.onChat?.(visible);
      return;
    }

    if (message.type === 'cutscene') {
      this.cutscene = message.cutscene;
      if (this.assembler?.hash !== message.cutscene?.hash) this.assembler = null;
      this.callbacks.onCutscene?.(message.cutscene);
      return;
    }

    if (message.type === 'image-part') {
      const image = this.assembler?.add(message.hash, message.index, message.total, message.data);
      if (image) {
        this.assembler = null;
        this.callbacks.onImage?.(message.hash, image);
      }
      return;
    }

    if (message.type === 'journal-put') {
      this.callbacks.onJournalEntry?.(message.entry);
      return;
    }

    if (message.type === 'journal-keep') {
      this.callbacks.onJournalKeep?.(message.ids);
      return;
    }

    if (message.type === 'turn') {
      this.callbacks.onTurnOrder?.(message.tracker);
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

  /**
   * Confere quem se apresenta como Mestre. Devolve `null` se não deve ser aceito.
   * Com a chave do Mestre conhecida, só a prova do desafio desta conexão vale. Sem chave
   * (campanha da v0.1), uma declaração sem prova ainda é aceita, e a primeira chave
   * provada passa a ser a da campanha.
   */
  private authenticate(hello: Extract<Hello, { role: 'mestre' }>): GmIdentity | null {
    const { gmKey, proof } = hello;
    if (gmKey !== undefined && proof !== undefined) {
      const genuine =
        (this.gmKey === undefined || gmKey === this.gmKey) &&
        verifyChallenge(gmKey, proof, this.campaign.id, this.challenge, this.campaign.gmId);
      if (!genuine) {
        this.forgeries++;
        for (const listener of this.listeners) listener();
        return null;
      }
      if (this.gmKey === undefined) {
        this.gmKey = gmKey;
        this.callbacks.onGmKeyLearned?.(gmKey);
      }
      return 'verificada';
    }
    return this.gmKey === undefined ? 'declarada' : null;
  }

  private setStatus(status: ClientStatus): void {
    this.current = status;
    for (const listener of this.listeners) listener();
  }
}
