import type { SyncTransport, TransportHandlers } from '@tabula/sync';

export type TransportFactory = (room: { roomId: string; secret: string }) => SyncTransport;

/** Quanto tempo a sala fica aberta depois de sair da sessão, para entrar de novo na hora. */
export const ROOM_IDLE_MS = 2 * 60_000;

const IGNORE: TransportHandlers = {
  onPeerJoin: () => {},
  onPeerLeave: () => {},
  onMessage: () => {},
};

interface Room {
  transport: SyncTransport;
  inUse: boolean;
  idle: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Mantém a sala (WebRTC + sinalização) aberta por um tempo depois de sair da sessão.
 *
 * Entrar numa sala custa: anunciar nos relays, achar o outro lado e abrir a conexão. Sair e
 * entrar de novo na mesma página ainda esbarrava num tempo de espera da biblioteca de WebRTC
 * (~9 s, a conexão antiga com o mesmo ID ainda parecia viva). Com a sala aberta, reentrar é
 * imediato; a saída é avisada pelo protocolo (`BYE`), e a sala fecha de verdade depois de
 * `ROOM_IDLE_MS` sem uso.
 */
export class TransportPool {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly create: TransportFactory,
    private readonly idleMs = ROOM_IDLE_MS,
  ) {}

  /** Uma "concessão" da sala: `leave()` só devolve a sala à piscina. */
  lease(room: { roomId: string; secret: string }): SyncTransport {
    const key = `${room.roomId}\n${room.secret}`;
    let entry = this.rooms.get(key);
    // Em uso por outra parte do app ao mesmo tempo: sala separada, como antes da piscina.
    if (entry?.inUse) return this.create(room);
    if (!entry) {
      entry = { transport: this.create(room), inUse: false, idle: undefined };
      this.rooms.set(key, entry);
    }
    clearTimeout(entry.idle);
    entry.inUse = true;
    const current = entry;
    let released = false;

    return {
      send: (peerId, data) => {
        if (!released) current.transport.send(peerId, data);
      },
      setHandlers: (handlers) => {
        if (!released) current.transport.setHandlers(handlers);
      },
      connectionInfo: async (peerId) =>
        released ? null : ((await current.transport.connectionInfo?.(peerId)) ?? null),
      leave: async () => {
        if (released) return;
        released = true;
        current.inUse = false;
        current.transport.setHandlers(IGNORE);
        current.idle = setTimeout(() => {
          if (current.inUse || this.rooms.get(key) !== current) return;
          this.rooms.delete(key);
          void current.transport.leave();
        }, this.idleMs);
      },
    };
  }

  /** Fecha todas as salas sem uso (ex.: testes). */
  async closeIdle(): Promise<void> {
    for (const [key, entry] of this.rooms) {
      if (entry.inUse) continue;
      clearTimeout(entry.idle);
      this.rooms.delete(key);
      await entry.transport.leave();
    }
  }
}
