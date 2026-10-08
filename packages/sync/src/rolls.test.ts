import { parseDice, rollDice, type RollEntry } from '@tabula/domain';
import { describe, expect, it } from 'vitest';
import { SessionClient } from './client';
import { SessionHost } from './host';
import { MemoryNetwork } from './memory-transport';
import { encodeLog } from './protocol';
import { newSheet, TEMPLATE } from './test-helpers';

const CAMPAIGN = { id: 'campanha', gmId: 'mestre', gmName: 'Paulo', templateId: TEMPLATE.id };

let nextRoll = 0;
function entry(authorId: string, change: Partial<RollEntry> = {}): RollEntry {
  const parsed = parseDice('1d20+3');
  if (!parsed.ok) throw new Error('dado');
  return {
    id: `r${++nextRoll}`,
    at: nextRoll,
    authorId,
    authorName: authorId,
    label: 'Atletismo',
    result: rollDice(parsed.value, () => 12),
    secret: false,
    ...change,
  };
}

function setUp() {
  const network = new MemoryNetwork();
  const host = new SessionHost(network.join(), CAMPAIGN);
  const fromPlayers: RollEntry[] = [];
  host.onRoll((roll) => fromPlayers.push(roll));
  host.start();
  const join = (userId: string, sheetId: string) => {
    const received: RollEntry[] = [];
    const transport = network.join();
    const client = new SessionClient(
      transport,
      CAMPAIGN,
      { userId, displayName: userId },
      newSheet(sheetId, userId),
      undefined,
      { onRolls: (entries) => received.push(...entries) },
    );
    client.start();
    return { client, received, transport };
  };
  return { network, host, fromPlayers, join };
}

describe('rolagens na mesa', () => {
  it('a rolagem da jogadora chega ao Mestre e aos outros, sem voltar para ela', async () => {
    const { network, host, fromPlayers, join } = setUp();
    const ana = join('ana', 's1');
    const bia = join('bia', 's2');
    await network.settle();

    const roll = entry('ana');
    expect(ana.client.roll(roll)).toBe(true);
    await network.settle();

    expect(fromPlayers).toEqual([roll]);
    expect(bia.received).toEqual([roll]);
    expect(ana.received).toEqual([]);
    expect(host.players()).toHaveLength(2);
  });

  it('rolagem pública do Mestre vai para todos; secreta não sai do aparelho', async () => {
    const { network, host, join } = setUp();
    const ana = join('ana', 's1');
    await network.settle();

    const publicRoll = entry('mestre');
    host.roll(publicRoll);
    host.roll(entry('mestre', { secret: true, label: 'Emboscada' }));
    await network.settle();
    expect(ana.received).toEqual([publicRoll]);
  });

  it('quem entra no meio da sessão recebe as rolagens recentes (só as públicas)', async () => {
    const { network, host, join } = setUp();
    const old = entry('mestre');
    host.seedRolls([old, entry('mestre', { secret: true })]);
    const first = join('ana', 's1');
    await network.settle();
    const fresh = entry('ana');
    first.client.roll(fresh);
    await network.settle();

    const late = join('bia', 's2');
    await network.settle();
    expect(late.received).toEqual([old, fresh]);
  });

  it('o Mestre ignora rolagem em nome de outro, secreta ou repetida', async () => {
    const { network, fromPlayers, join } = setUp();
    const ana = join('ana', 's1');
    const bia = join('bia', 's2');
    await network.settle();

    const own = entry('ana');
    ana.client.roll(entry('bia'));
    ana.client.roll(entry('ana', { secret: true }));
    ana.client.roll(own);
    ana.client.roll(own);
    await network.settle();

    expect(fromPlayers).toEqual([own]);
    expect(bia.received).toEqual([own]);
  });

  it('rolagem adulterada é descartada ao chegar', async () => {
    const { network, fromPlayers, join } = setUp();
    const ana = join('ana', 's1');
    await network.settle();

    const forged = entry('ana');
    forged.result.total = 40;
    // Envia direto, sem passar pelo app (como faria um cliente modificado).
    const gmPeer = network.peersOf(ana.transport)[0] as string;
    ana.transport.send(gmPeer, encodeLog([forged]));
    await network.settle();
    expect(fromPlayers).toEqual([]);
  });

  it('sem o Mestre conectado, a rolagem fica só no aparelho', async () => {
    const network = new MemoryNetwork();
    const client = new SessionClient(
      network.join(),
      CAMPAIGN,
      { userId: 'ana', displayName: 'Ana' },
      newSheet('s1', 'ana'),
    );
    client.start();
    await network.settle();
    expect(client.roll(entry('ana'))).toBe(false);
  });
});
