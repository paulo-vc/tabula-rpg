import type { JournalEntry } from '@tabula/domain';
import { describe, expect, it } from 'vitest';
import { SessionClient } from './client';
import { SessionHost } from './host';
import { generateGmKeyPair } from './identity';
import { MemoryNetwork } from './memory-transport';
import { decodeMessage, encodeJournalPut } from './protocol';
import { newSheet, TEMPLATE } from './test-helpers';

const gm = generateGmKeyPair();
const CAMPAIGN = { id: 'campanha', gmId: 'mestre', gmName: 'Paulo', templateId: TEMPLATE.id };

const entry = (id: string, changes: Partial<JournalEntry> = {}): JournalEntry => ({
  id,
  title: `Sessão ${id}`,
  text: 'A mesa chegou à mina.',
  shared: true,
  createdAt: 1,
  updatedAt: 1,
  ...changes,
});

function startHost(network: MemoryNetwork) {
  const host = new SessionHost(network.join(), { ...CAMPAIGN, identity: gm });
  host.start();
  return host;
}

/** Jogadora que guarda o diário recebido, como o app faz no banco. */
function startPlayer(network: MemoryNetwork) {
  const journal = new Map<string, JournalEntry>();
  const client = new SessionClient(
    network.join(),
    { id: CAMPAIGN.id, gmId: CAMPAIGN.gmId, gmKey: gm.publicKey },
    { userId: 'ana', displayName: 'Ana' },
    newSheet('s1', 'ana'),
    undefined,
    {
      onJournalEntry: (e) => journal.set(e.id, e),
      onJournalKeep: (ids) => {
        for (const id of [...journal.keys()]) if (!ids.includes(id)) journal.delete(id);
      },
    },
  );
  client.start();
  return journal;
}

describe('diário na sessão', () => {
  it('entradas compartilhadas chegam; alterar e deixar de compartilhar também', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    const journal = startPlayer(network);
    await network.settle();

    host.setJournal([entry('e1'), entry('e2')]);
    await network.settle();
    expect([...journal.keys()].sort()).toEqual(['e1', 'e2']);

    host.setJournal([entry('e1', { title: 'Sessão 1: a mina', updatedAt: 2 }), entry('e2')]);
    await network.settle();
    expect(journal.get('e1')?.title).toBe('Sessão 1: a mina');

    // e2 virou nota privada: o Mestre a passa como não compartilhada.
    host.setJournal([entry('e1', { updatedAt: 2 }), entry('e2', { shared: false })]);
    await network.settle();
    expect([...journal.keys()]).toEqual(['e1']);
  });

  it('notas do Mestre (não compartilhadas) nunca saem', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    const journal = startPlayer(network);
    await network.settle();
    host.setJournal([entry('nota', { shared: false })]);
    await network.settle();
    expect(journal.size).toBe(0);
    // Mesmo que alguém tente enviar uma, o protocolo recusa.
    expect(decodeMessage(encodeJournalPut(entry('nota', { shared: false })))).toBeNull();
  });

  it('quem entra depois recebe o diário inteiro, e apaga o que deixou de valer', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    host.setJournal([entry('e1'), entry('e2')]);
    const journal = startPlayer(network);
    journal.set('velha', entry('velha'));
    await network.settle();
    expect([...journal.keys()].sort()).toEqual(['e1', 'e2']);
  });

  it('diário enviado por quem não provou ser o Mestre é ignorado', async () => {
    const network = new MemoryNetwork();
    const journal = startPlayer(network);
    const attacker = network.join();
    attacker.setHandlers({
      onPeerJoin: (peerId) => attacker.send(peerId, encodeJournalPut(entry('falsa'))),
      onPeerLeave: () => {},
      onMessage: () => {},
    });
    await network.settle();
    expect(journal.size).toBe(0);
  });
});
