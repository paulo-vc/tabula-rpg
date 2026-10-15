import type { ChatMessage } from '@tabula/domain';
import { describe, expect, it } from 'vitest';
import { SessionClient } from './client';
import { SessionHost } from './host';
import { MemoryNetwork } from './memory-transport';
import { encodeChat } from './protocol';
import { newSheet, TEMPLATE } from './test-helpers';

const CAMPAIGN = { id: 'campanha', gmId: 'mestre', gmName: 'Paulo', templateId: TEMPLATE.id };

let next = 0;
function message(authorId: string, change: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m${++next}`,
    at: next,
    authorId,
    authorName: authorId,
    kind: 'fala',
    text: `Mensagem ${next}`,
    ...change,
  };
}

const whisper = (authorId: string, to: string): ChatMessage =>
  message(authorId, { to, toName: to });

function setUp() {
  const network = new MemoryNetwork();
  const host = new SessionHost(network.join(), CAMPAIGN);
  const fromPlayers: ChatMessage[] = [];
  host.onChat((m) => fromPlayers.push(m));
  host.start();
  const join = (userId: string, sheetId: string) => {
    const received: ChatMessage[] = [];
    const transport = network.join();
    const client = new SessionClient(
      transport,
      CAMPAIGN,
      { userId, displayName: userId },
      newSheet(sheetId, userId),
      undefined,
      { onChat: (messages) => received.push(...messages) },
    );
    client.start();
    return { client, received, transport };
  };
  return { network, host, fromPlayers, join };
}

describe('chat da sessão', () => {
  it('a mensagem da jogadora chega ao Mestre e aos outros, sem voltar para ela', async () => {
    const { network, fromPlayers, join } = setUp();
    const ana = join('ana', 's1');
    const bia = join('bia', 's2');
    await network.settle();

    const hello = message('ana', { kind: 'personagem', character: 'Lia' });
    expect(ana.client.chat(hello)).toBe(true);
    await network.settle();

    expect(fromPlayers).toEqual([hello]);
    expect(bia.received).toEqual([hello]);
    expect(ana.received).toEqual([]);
  });

  it('o Mestre fala com a mesa ou sussurra só a um jogador', async () => {
    const { network, host, join } = setUp();
    const ana = join('ana', 's1');
    const bia = join('bia', 's2');
    await network.settle();

    const toAll = message('mestre');
    const toAna = whisper('mestre', 'ana');
    host.chat(toAll);
    host.chat(toAna);
    await network.settle();

    expect(ana.received).toEqual([toAll, toAna]);
    expect(bia.received).toEqual([toAll]);
  });

  it('o sussurro da jogadora ao Mestre não chega aos outros', async () => {
    const { network, fromPlayers, join } = setUp();
    const ana = join('ana', 's1');
    const bia = join('bia', 's2');
    await network.settle();

    const secret = whisper('ana', 'mestre');
    ana.client.chat(secret);
    await network.settle();

    expect(fromPlayers).toEqual([secret]);
    expect(bia.received).toEqual([]);
  });

  it('quem entra depois recebe a conversa recente, só com os próprios sussurros', async () => {
    const { network, host, join } = setUp();
    const old = message('mestre');
    const toBia = whisper('mestre', 'bia');
    host.seedChat([old, toBia, whisper('mestre', 'ana')]);
    const ana = join('ana', 's1');
    await network.settle();
    const fresh = message('ana');
    ana.client.chat(fresh);
    await network.settle();

    const bia = join('bia', 's2');
    await network.settle();
    expect(bia.received).toEqual([old, toBia, fresh]);
  });

  it('o Mestre ignora mensagem em nome de outro, repetida ou sussurrada a outro jogador', async () => {
    const { network, fromPlayers, join } = setUp();
    const ana = join('ana', 's1');
    const bia = join('bia', 's2');
    await network.settle();

    const own = message('ana');
    ana.client.chat(message('bia'));
    ana.client.chat(message('ana', { authorName: 'Mestre' }));
    ana.client.chat(whisper('ana', 'bia'));
    ana.client.chat(own);
    ana.client.chat(own);
    await network.settle();

    expect(fromPlayers).toEqual([own]);
    expect(bia.received).toEqual([own]);
  });

  it('mensagem malformada é descartada ao chegar', async () => {
    const { network, fromPlayers, join } = setUp();
    const ana = join('ana', 's1');
    await network.settle();

    // Envia direto, sem passar pelo app (como faria um cliente modificado).
    const gmPeer = network.peersOf(ana.transport)[0] as string;
    ana.transport.send(gmPeer, encodeChat([message('ana', { text: 'x'.repeat(5000) })]));
    ana.transport.send(gmPeer, encodeChat([message('ana', { kind: 'personagem' })]));
    await network.settle();
    expect(fromPlayers).toEqual([]);
  });

  it('o jogador ignora mensagens que não vêm do Mestre', async () => {
    const { network, join } = setUp();
    const ana = join('ana', 's1');
    const bia = join('bia', 's2');
    await network.settle();

    // Bia manda a todos, direto, uma mensagem como se fosse do Mestre.
    for (const peer of network.peersOf(bia.transport)) {
      bia.transport.send(peer, encodeChat([message('mestre')]));
    }
    await network.settle();
    expect(ana.received).toEqual([]);
  });

  it('sem o Mestre conectado, a mensagem não sai', async () => {
    const network = new MemoryNetwork();
    const client = new SessionClient(
      network.join(),
      CAMPAIGN,
      { userId: 'ana', displayName: 'Ana' },
      newSheet('s1', 'ana'),
    );
    client.start();
    await network.settle();
    expect(client.chat(message('ana'))).toBe(false);
  });
});
