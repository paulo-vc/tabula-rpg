import type { SyncTransport, TransportHandlers } from '@tabula/sync';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransportPool } from './transport-pool';

function fakeFactory() {
  const created: { left: boolean; handlers: TransportHandlers | null; sent: string[] }[] = [];
  const factory = (): SyncTransport => {
    const state = { left: false, handlers: null as TransportHandlers | null, sent: [] as string[] };
    created.push(state);
    return {
      send: (peerId) => state.sent.push(peerId),
      setHandlers: (handlers) => {
        state.handlers = handlers;
      },
      leave: async () => {
        state.left = true;
      },
    };
  };
  return { created, factory };
}

const ROOM = { roomId: 'campanha', secret: 'segredo' };

afterEach(() => {
  vi.useRealTimers();
});

describe('piscina de salas', () => {
  it('sair e entrar de novo reaproveita a mesma sala', async () => {
    const { created, factory } = fakeFactory();
    const pool = new TransportPool(factory);
    const first = pool.lease(ROOM);
    await first.leave();
    pool.lease(ROOM);
    expect(created).toHaveLength(1);
    expect(created[0]?.left).toBe(false);
  });

  it('a concessão devolvida não envia nem recebe mais', async () => {
    const { created, factory } = fakeFactory();
    const pool = new TransportPool(factory);
    const lease = pool.lease(ROOM);
    await lease.leave();
    lease.send('peer', new Uint8Array([1]));
    expect(created[0]?.sent).toEqual([]);
    const onMessage = vi.fn();
    lease.setHandlers({ onPeerJoin: () => {}, onPeerLeave: () => {}, onMessage });
    created[0]?.handlers?.onMessage('peer', new Uint8Array([1]));
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('em uso ao mesmo tempo, abre uma sala separada', () => {
    const { created, factory } = fakeFactory();
    const pool = new TransportPool(factory);
    pool.lease(ROOM);
    pool.lease(ROOM);
    expect(created).toHaveLength(2);
  });

  it('sem uso, a sala fecha de verdade depois do tempo de espera', async () => {
    vi.useFakeTimers();
    const { created, factory } = fakeFactory();
    const pool = new TransportPool(factory, 1000);
    await pool.lease(ROOM).leave();
    vi.advanceTimersByTime(999);
    expect(created[0]?.left).toBe(false);
    vi.advanceTimersByTime(1);
    expect(created[0]?.left).toBe(true);
    pool.lease(ROOM);
    expect(created).toHaveLength(2);
  });

  it('voltar antes do tempo cancela o fechamento', async () => {
    vi.useFakeTimers();
    const { created, factory } = fakeFactory();
    const pool = new TransportPool(factory, 1000);
    await pool.lease(ROOM).leave();
    vi.advanceTimersByTime(500);
    pool.lease(ROOM);
    vi.advanceTimersByTime(5000);
    expect(created[0]?.left).toBe(false);
  });
});
