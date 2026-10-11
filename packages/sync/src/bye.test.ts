import { describe, expect, it } from 'vitest';
import { SessionClient } from './client';
import { SessionHost } from './host';
import { generateGmKeyPair } from './identity';
import { MemoryNetwork } from './memory-transport';
import { newSheet, TEMPLATE } from './test-helpers';
import type { SyncTransport } from './transport';

const gm = generateGmKeyPair();
const CAMPAIGN = { id: 'campanha', gmId: 'mestre', gmName: 'Paulo', templateId: TEMPLATE.id };

/** Transporte que continua na sala ao "sair" (como o app faz, para reentrar na hora). */
function keptOpen(transport: SyncTransport): SyncTransport {
  return {
    send: (peerId, data) => transport.send(peerId, data),
    setHandlers: (handlers) => transport.setHandlers(handlers),
    leave: async () =>
      transport.setHandlers({ onPeerJoin: () => {}, onPeerLeave: () => {}, onMessage: () => {} }),
  };
}

const newClient = (transport: SyncTransport) => {
  const client = new SessionClient(
    transport,
    { id: CAMPAIGN.id, gmId: CAMPAIGN.gmId, gmKey: gm.publicKey },
    { userId: 'ana', displayName: 'Ana' },
    newSheet('s1', 'ana'),
  );
  client.start();
  return client;
};
const newHost = (transport: SyncTransport) => {
  const host = new SessionHost(transport, { ...CAMPAIGN, identity: gm });
  host.start();
  return host;
};

describe('sair da sessão com a sala aberta (BYE)', () => {
  it('o jogador sai: o Mestre o vê offline; entra de novo: online na hora', async () => {
    const network = new MemoryNetwork();
    const host = newHost(network.join());
    const playerTransport = keptOpen(network.join());
    const first = newClient(playerTransport);
    await network.settle();
    expect(host.players()[0]?.online).toBe(true);

    await first.stop();
    await network.settle();
    expect(host.players()[0]?.online).toBe(false);

    const again = newClient(playerTransport);
    await network.settle();
    expect(again.status()).toEqual({ state: 'conectado' });
    expect(host.players()[0]?.online).toBe(true);
  });

  it('o Mestre encerra: o jogador volta a procurar; reabre: reconecta sem recarregar', async () => {
    const network = new MemoryNetwork();
    const gmTransport = keptOpen(network.join());
    const host = newHost(gmTransport);
    const client = newClient(network.join());
    await network.settle();
    expect(client.status()).toEqual({ state: 'conectado' });

    await host.stop();
    await network.settle();
    expect(client.status()).toEqual({ state: 'procurando-mestre' });

    newHost(gmTransport);
    await network.settle();
    expect(client.status()).toEqual({ state: 'conectado' });
    expect(client.identity()).toBe('verificada');
  });

  it('BYE de quem não é o Mestre não derruba a conexão', async () => {
    const network = new MemoryNetwork();
    newHost(network.join());
    const client = newClient(network.join());
    const other = network.join();
    await network.settle();
    other.setHandlers({ onPeerJoin: () => {}, onPeerLeave: () => {}, onMessage: () => {} });
    const { encodeBye } = await import('./protocol');
    for (const peer of ['peer-1', 'peer-2']) other.send(peer, encodeBye());
    await network.settle();
    expect(client.status()).toEqual({ state: 'conectado' });
  });
});
