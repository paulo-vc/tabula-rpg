import type { SyncTransport, TransportHandlers } from './transport';

type Delivery = () => void;

/**
 * Rede simulada em memória para testes: todos os participantes de uma sala se enxergam
 * (como no WebRTC em malha). As entregas são assíncronas e em ordem; `settle()` processa
 * tudo o que está pendente, deixando os testes determinísticos.
 */
export class MemoryNetwork {
  private readonly endpoints = new Map<string, MemoryTransport>();
  private readonly queue: Delivery[] = [];
  private nextId = 0;

  /** Entra na sala com um novo participante. */
  join(): MemoryTransport {
    const transport = new MemoryTransport(`peer-${++this.nextId}`, this);
    this.connect(transport);
    return transport;
  }

  /** Conecta (ou reconecta) um participante: todos se anunciam mutuamente. */
  connect(transport: MemoryTransport): void {
    if (this.endpoints.has(transport.id)) return;
    for (const other of this.endpoints.values()) {
      this.enqueue(() => other.handlers?.onPeerJoin(transport.id));
      this.enqueue(() => transport.handlers?.onPeerJoin(other.id));
    }
    this.endpoints.set(transport.id, transport);
  }

  /** Simula a queda da conexão de um participante (os demais percebem a saída). */
  disconnect(transport: MemoryTransport): void {
    if (!this.endpoints.delete(transport.id)) return;
    for (const other of this.endpoints.values()) {
      this.enqueue(() => other.handlers?.onPeerLeave(transport.id));
      this.enqueue(() => transport.handlers?.onPeerLeave(other.id));
    }
  }

  isConnected(transport: MemoryTransport): boolean {
    return this.endpoints.has(transport.id);
  }

  /** Lista de participantes conectados, exceto `self`. */
  peersOf(self: MemoryTransport): string[] {
    return [...this.endpoints.keys()].filter((id) => id !== self.id);
  }

  deliver(from: MemoryTransport, to: string, data: Uint8Array): void {
    // Cópia: o destinatário nunca compartilha memória com o remetente (como na rede real).
    const copy = data.slice();
    this.enqueue(() => {
      if (!this.endpoints.has(from.id)) return; // remetente caiu antes da entrega
      this.endpoints.get(to)?.handlers?.onMessage(from.id, copy);
    });
  }

  private enqueue(delivery: Delivery): void {
    this.queue.push(delivery);
  }

  /** Processa todas as entregas pendentes, inclusive as geradas durante o processamento. */
  async settle(maxSteps = 100_000): Promise<void> {
    let steps = 0;
    while (this.queue.length > 0) {
      if (++steps > maxSteps) throw new Error('A rede não estabilizou (laço de mensagens?)');
      (this.queue.shift() as Delivery)();
      // Deixa promessas pendentes (ex.: callbacks assíncronos) avançarem.
      await Promise.resolve();
    }
  }
}

export class MemoryTransport implements SyncTransport {
  handlers: TransportHandlers | null = null;

  constructor(
    readonly id: string,
    private readonly network: MemoryNetwork,
  ) {}

  send(peerId: string, data: Uint8Array): void {
    if (!this.network.isConnected(this)) return;
    this.network.deliver(this, peerId, data);
  }

  setHandlers(handlers: TransportHandlers): void {
    this.handlers = handlers;
    if (!this.network.isConnected(this)) return;
    for (const peerId of this.network.peersOf(this)) handlers.onPeerJoin(peerId);
  }

  async leave(): Promise<void> {
    this.network.disconnect(this);
  }
}
