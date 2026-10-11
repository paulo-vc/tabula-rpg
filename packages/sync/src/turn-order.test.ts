import {
  addCombatant,
  nextTurn,
  publicView,
  startCombat,
  type PublicTracker,
} from '@tabula/domain';
import { describe, expect, it } from 'vitest';
import { SessionClient } from './client';
import { SessionHost } from './host';
import { generateGmKeyPair } from './identity';
import { MemoryNetwork } from './memory-transport';
import { encodeTurn } from './protocol';
import { newSheet, TEMPLATE } from './test-helpers';

const gm = generateGmKeyPair();
const CAMPAIGN = { id: 'campanha', gmId: 'mestre', gmName: 'Paulo', templateId: TEMPLATE.id };

function startHost(network: MemoryNetwork) {
  const host = new SessionHost(network.join(), { ...CAMPAIGN, identity: gm });
  host.start();
  return host;
}

function startPlayer(network: MemoryNetwork, userId: string) {
  const received: (PublicTracker | null)[] = [];
  const client = new SessionClient(
    network.join(),
    { id: CAMPAIGN.id, gmId: CAMPAIGN.gmId, gmKey: gm.publicKey },
    { userId, displayName: userId },
    newSheet(`ficha-${userId}`, userId),
    undefined,
    { onTurnOrder: (tracker) => received.push(tracker) },
  );
  client.start();
  return { client, received };
}

/** Ana (15) e um goblin oculto (20), em combate: o goblin age primeiro. */
function combat() {
  let tracker = startCombat([{ id: 'ficha-ana', name: 'Ana', userId: 'ana' }]);
  tracker = { ...tracker, combatants: tracker.combatants.map((c) => ({ ...c, initiative: 15 })) };
  tracker = addCombatant(tracker, {
    id: 'goblin',
    name: 'Goblin',
    initiative: 20,
    kind: 'npc',
    hidden: true,
  });
  return nextTurn(tracker);
}

describe('ordem de turno na sessão', () => {
  it('o jogador recebe a ordem pública (sem ocultos) e o fim do combate', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    const { received } = startPlayer(network, 'ana');
    await network.settle();

    host.setTurnOrder(publicView(combat()));
    await network.settle();
    expect(received.at(-1)).toMatchObject({ phase: 'combate', activeId: null });
    expect(received.at(-1)?.combatants.map((c) => c.name)).toEqual(['Ana']);

    host.setTurnOrder(null);
    await network.settle();
    expect(received.at(-1)).toBeNull();
  });

  it('quem entra no meio do combate recebe a ordem atual', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    host.setTurnOrder(publicView(nextTurn(combat())));
    await network.settle();

    const { received } = startPlayer(network, 'ana');
    await network.settle();
    expect(received).toEqual([expect.objectContaining({ activeId: 'ficha-ana' })]);
  });

  it('ordem enviada por quem não provou ser o Mestre é ignorada', async () => {
    const network = new MemoryNetwork();
    const { received } = startPlayer(network, 'ana');
    const attacker = network.join();
    attacker.setHandlers({
      onPeerJoin: (peerId) => attacker.send(peerId, encodeTurn(publicView(combat()))),
      onPeerLeave: () => {},
      onMessage: () => {},
    });
    await network.settle();
    expect(received).toEqual([]);
  });
});
