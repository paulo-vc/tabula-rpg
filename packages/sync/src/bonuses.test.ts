import type { Bonus, CharacterSheet } from '@tabula/domain';
import { describe, expect, it } from 'vitest';
import { SessionClient } from './client';
import { SessionHost } from './host';
import { MemoryNetwork } from './memory-transport';
import { BONUSES } from './sheet-doc';
import { newSheet, TEMPLATE } from './test-helpers';

const CAMPAIGN = { id: 'campanha', gmId: 'mestre', gmName: 'Paulo', templateId: TEMPLATE.id };

const bonus = (id: string, overrides: Partial<Bonus> = {}): Bonus => ({
  id,
  name: id,
  kind: 'item',
  active: true,
  targets: [{ fieldId: 'forca', value: 2 }],
  ...overrides,
});

/**
 * Jogador com "banco local": os bônus que o Mestre muda são gravados na ficha local, e a
 * ficha volta para o cliente (como faz o app, que observa o banco).
 */
function startPlayer(network: MemoryNetwork, initial: CharacterSheet) {
  let sheet = initial;
  const received: Bonus[][] = [];
  const client = new SessionClient(
    network.join(),
    CAMPAIGN,
    { userId: sheet.ownerId, displayName: sheet.ownerId },
    sheet,
    undefined,
    {
      onRemoteBonuses: (bonuses) => {
        received.push(bonuses);
        sheet = { ...sheet, bonuses };
        client.update(sheet);
      },
    },
  );
  client.start();
  return {
    client,
    received,
    sheet: () => sheet,
    setBonuses: (bonuses: Bonus[]) => {
      sheet = { ...sheet, bonuses };
      client.update(sheet);
    },
  };
}

function setUp() {
  const network = new MemoryNetwork();
  const host = new SessionHost(network.join(), CAMPAIGN);
  host.start();
  return { network, host, gmBonuses: () => host.players()[0]?.sheet?.bonuses };
}

describe('bônus na sessão', () => {
  it('os bônus da jogadora chegam ao Mestre', async () => {
    const { network, gmBonuses } = setUp();
    const ana = startPlayer(network, { ...newSheet('s1', 'ana'), bonuses: [bonus('cinto')] });
    await network.settle();
    expect(gmBonuses()).toEqual([bonus('cinto')]);

    ana.setBonuses([bonus('cinto', { active: false })]);
    await network.settle();
    expect(gmBonuses()).toEqual([bonus('cinto', { active: false })]);
  });

  it('o Mestre aplica uma maldição e ela chega à ficha da jogadora', async () => {
    const { network, host } = setUp();
    const ana = startPlayer(network, { ...newSheet('s1', 'ana'), bonuses: [bonus('cinto')] });
    await network.settle();

    const curse = bonus('maldicao', {
      kind: 'maldicao',
      targets: [{ fieldId: 'forca', value: -2 }],
    });
    expect(host.setBonuses('s1', [bonus('cinto'), curse])).toBe(true);
    await network.settle();
    expect(ana.sheet().bonuses).toEqual([bonus('cinto'), curse]);

    // E remove depois.
    host.setBonuses('s1', [bonus('cinto')]);
    await network.settle();
    expect(ana.sheet().bonuses).toEqual([bonus('cinto')]);
  });

  it('a jogadora e o Mestre mexendo em bônus diferentes ao mesmo tempo: os dois ficam', async () => {
    const { network, host, gmBonuses } = setUp();
    const ana = startPlayer(network, newSheet('s1', 'ana'));
    await network.settle();

    // Sem esperar a rede entre um e outro.
    ana.setBonuses([bonus('anel')]);
    host.setBonuses('s1', [bonus('bencao', { kind: 'bencao' })]);
    await network.settle();

    const expected = [bonus('anel'), bonus('bencao', { kind: 'bencao' })];
    expect(gmBonuses()).toEqual(expected);
    expect(ana.sheet().bonuses).toEqual(expected);
  });

  it('bônus malformado vindo da rede é ignorado, sem perder a ficha', async () => {
    const { network, host, gmBonuses } = setUp();
    const ana = startPlayer(network, { ...newSheet('s1', 'ana'), bonuses: [bonus('cinto')] });
    await network.settle();

    // Como faria um cliente modificado: grava direto no documento um bônus inválido.
    (ana.client as unknown as { doc: { getMap: (name: string) => Map<string, unknown> } }).doc
      .getMap(BONUSES)
      .set('estragado', { id: 'estragado', name: '', targets: [] });
    await network.settle();

    expect(gmBonuses()).toEqual([bonus('cinto')]);
    expect(host.players()[0]?.sheet?.name).toBe('Ficha s1');
  });
});
