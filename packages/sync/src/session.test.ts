import type { CharacterSheet } from '@tabula/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SessionClient } from './client';
import { SessionHost, type SavedSheetState } from './host';
import { MemoryNetwork, type MemoryTransport } from './memory-transport';
import { encodeHello, PROTOCOL_VERSION, syncEncoder } from './protocol';
import { newSheet, TEMPLATE, withValue } from './test-helpers';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import { readSheet } from './sheet-doc';

const CAMPAIGN = { id: 'campanha', gmId: 'mestre', gmName: 'Paulo', templateId: TEMPLATE.id };

function startHost(network: MemoryNetwork, saved?: Map<string, SavedSheetState>) {
  const transport = network.join();
  const host = new SessionHost(transport, CAMPAIGN, saved);
  host.start();
  return { host, transport };
}

function startPlayer(
  network: MemoryNetwork,
  userId: string,
  sheet: CharacterSheet,
  savedState?: Uint8Array,
  transport: MemoryTransport = network.join(),
) {
  const client = new SessionClient(
    transport,
    CAMPAIGN,
    { userId, displayName: userId },
    sheet,
    savedState,
  );
  client.start();
  return { client, transport };
}

const playerSheet = (host: SessionHost, sheetId: string) =>
  host.players().find((p) => p.sheetId === sheetId);

describe('sessão', () => {
  it('o jogador entra e o Mestre recebe a ficha completa', async () => {
    const network = new MemoryNetwork();
    const { host } = startHost(network);
    const sheet = withValue(newSheet('s1', 'ana'), 'forca', 16);
    const { client } = startPlayer(network, 'ana', sheet);
    await network.settle();

    expect(client.status()).toEqual({ state: 'conectado' });
    expect(playerSheet(host, 's1')).toMatchObject({
      userId: 'ana',
      displayName: 'ana',
      online: true,
      sheet: { name: 'Ficha s1', values: sheet.values, invalidValues: 0 },
    });
  });

  it('alterações do jogador chegam ao Mestre', async () => {
    const network = new MemoryNetwork();
    const { host } = startHost(network);
    let sheet = newSheet('s1', 'ana');
    const { client } = startPlayer(network, 'ana', sheet);
    await network.settle();

    let notifications = 0;
    host.subscribe(() => notifications++);
    sheet = withValue(withValue(sheet, 'hp', { current: 3, max: 10 }), 'envenenado', true);
    client.update({ ...sheet, name: 'Ana, a Ousada' });
    await network.settle();

    expect(notifications).toBeGreaterThan(0);
    expect(playerSheet(host, 's1')?.sheet).toMatchObject({
      name: 'Ana, a Ousada',
      values: { hp: { current: 3, max: 10 }, envenenado: true },
    });
  });

  it('o jogador pode entrar antes do Mestre', async () => {
    const network = new MemoryNetwork();
    const { client } = startPlayer(network, 'ana', newSheet('s1', 'ana'));
    await network.settle();
    expect(client.status()).toEqual({ state: 'procurando-mestre' });

    const { host } = startHost(network);
    await network.settle();
    expect(client.status()).toEqual({ state: 'conectado' });
    expect(playerSheet(host, 's1')?.online).toBe(true);
  });

  it('cada jogador sincroniza só a própria ficha (estrela)', async () => {
    const network = new MemoryNetwork();
    const { host } = startHost(network);
    const ana = startPlayer(network, 'ana', newSheet('s1', 'ana'));
    const bia = startPlayer(network, 'bia', newSheet('s2', 'bia'));
    await network.settle();

    expect(
      host
        .players()
        .map((p) => p.sheetId)
        .sort(),
    ).toEqual(['s1', 's2']);
    // O documento de cada jogadora contém só a ficha dela.
    const read = (state: Uint8Array) => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, state);
      return readSheet(doc)?.id;
    };
    expect(read(ana.client.exportState())).toBe('s1');
    expect(read(bia.client.exportState())).toBe('s2');
  });

  it('o jogador que cai aparece offline e, ao voltar, envia o que editou offline', async () => {
    const network = new MemoryNetwork();
    const { host } = startHost(network);
    let sheet = newSheet('s1', 'ana');
    const { client, transport } = startPlayer(network, 'ana', sheet);
    await network.settle();

    network.disconnect(transport);
    await network.settle();
    expect(playerSheet(host, 's1')?.online).toBe(false);
    expect(client.status()).toEqual({ state: 'procurando-mestre' });

    sheet = withValue(sheet, 'forca', 20); // editado sem conexão
    client.update(sheet);
    network.connect(transport);
    await network.settle();

    expect(client.status()).toEqual({ state: 'conectado' });
    expect(playerSheet(host, 's1')).toMatchObject({
      online: true,
      sheet: { values: { forca: 20 } },
    });
  });

  it('jogador que recarrega a página (documento novo) não perde para valores antigos', async () => {
    // Escritas concorrentes no Yjs são desempatadas pelo ID aleatório do cliente: sem a regra
    // "só escrever depois de conhecer o estado do Mestre", o valor antigo vence ~50% das vezes.
    // Repetir torna a falha praticamente certa caso a regra seja quebrada (0,5^30).
    for (let attempt = 0; attempt < 30; attempt++) {
      const network = new MemoryNetwork();
      const { host } = startHost(network);
      let sheet = withValue(newSheet('s1', 'ana'), 'forca', 12);
      const first = startPlayer(network, 'ana', sheet);
      await network.settle();
      await first.client.stop();
      await network.settle();

      // Página recarregada: novo cliente, sem estado salvo, com a ficha local mais nova.
      sheet = withValue(sheet, 'forca', 17);
      startPlayer(network, 'ana', sheet);
      await network.settle();
      expect(playerSheet(host, 's1')?.sheet?.values.forca).toBe(17);
    }
  });

  it('o Mestre reinicia com o estado salvo e continua de onde parou', async () => {
    const network = new MemoryNetwork();
    const first = startHost(network);
    const sheet = withValue(newSheet('s1', 'ana'), 'forca', 15);
    const player = startPlayer(network, 'ana', sheet);
    await network.settle();
    const saved = first.host.exportState();
    await first.host.stop();
    await network.settle();

    const second = startHost(network, saved);
    expect(playerSheet(second.host, 's1')).toMatchObject({
      online: false,
      sheet: { values: { forca: 15 } },
    });
    await network.settle();
    expect(player.client.status()).toEqual({ state: 'conectado' });
    expect(playerSheet(second.host, 's1')?.online).toBe(true);
  });

  it('recusa ficha de outro sistema', async () => {
    const network = new MemoryNetwork();
    const { host } = startHost(network);
    const sheet = newSheet('s1', 'ana');
    const other = { ...sheet, templateRef: { ...sheet.templateRef, id: 'outro-sistema' } };
    const { client } = startPlayer(network, 'ana', other);
    await network.settle();

    expect(client.status()).toMatchObject({
      state: 'recusado',
      reason: { code: 'sistema-diferente' },
    });
    expect(host.players()).toEqual([]);
  });

  it('recusa quem tenta assumir a ficha de outro jogador', async () => {
    const network = new MemoryNetwork();
    const { host } = startHost(network);
    startPlayer(network, 'ana', withValue(newSheet('s1', 'ana'), 'forca', 14));
    await network.settle();

    const intruder = startPlayer(network, 'eva', withValue(newSheet('s1', 'eva'), 'forca', 1));
    await network.settle();

    expect(intruder.client.status()).toMatchObject({
      state: 'recusado',
      reason: { code: 'ficha-de-outro' },
    });
    expect(playerSheet(host, 's1')?.sheet?.values.forca).toBe(14);
  });

  it('o jogador ignora quem se apresenta como Mestre com outro ID', async () => {
    const network = new MemoryNetwork();
    const impostor = network.join();
    impostor.setHandlers({
      onPeerJoin: (peerId) =>
        impostor.send(
          peerId,
          encodeHello({
            protocol: PROTOCOL_VERSION,
            role: 'mestre',
            campaignId: 'campanha',
            userId: 'impostor',
            displayName: 'Falso',
          }),
        ),
      onPeerLeave: () => {},
      onMessage: () => {},
    });
    const { client } = startPlayer(network, 'ana', newSheet('s1', 'ana'));
    await network.settle();
    expect(client.status()).toEqual({ state: 'procurando-mestre' });
  });

  it('ignora mensagens malformadas sem quebrar a sessão', async () => {
    const network = new MemoryNetwork();
    const { host } = startHost(network);
    const { client } = startPlayer(network, 'ana', newSheet('s1', 'ana'));
    const attacker = network.join();
    attacker.setHandlers({ onPeerJoin: () => {}, onPeerLeave: () => {}, onMessage: () => {} });
    await network.settle();

    const peers = network.peersOf(attacker);
    const garbage = [
      new Uint8Array([]),
      new Uint8Array([255, 255, 255]),
      new Uint8Array([0, 5, 123, 125]), // HELLO com JSON truncado
      new Uint8Array(600 * 1024), // grande demais
    ];
    // SYNC para uma ficha alheia, com atualização Yjs inválida.
    const fakeSync = syncEncoder('s1');
    encoding.writeVarUint(fakeSync, 2);
    encoding.writeVarUint8Array(fakeSync, new Uint8Array([9, 9, 9]));
    garbage.push(encoding.toUint8Array(fakeSync));

    for (const peerId of peers) for (const data of garbage) attacker.send(peerId, data);
    await network.settle();

    expect(client.status()).toEqual({ state: 'conectado' });
    expect(host.players()).toHaveLength(1);
    expect(playerSheet(host, 's1')?.sheet?.invalidValues).toBe(0);
  });

  it('limite de jogadores online', async () => {
    const network = new MemoryNetwork();
    const transport = network.join();
    const host = new SessionHost(transport, CAMPAIGN, new Map(), 1);
    host.start();
    startPlayer(network, 'ana', newSheet('s1', 'ana'));
    const bia = startPlayer(network, 'bia', newSheet('s2', 'bia'));
    await network.settle();
    expect(bia.client.status()).toMatchObject({
      state: 'recusado',
      reason: { code: 'sala-cheia' },
    });
  });
});

describe('convergência (propriedade)', () => {
  type Step =
    | { kind: 'editar'; field: 'forca' | 'nome' | 'envenenado'; value: number | string | boolean }
    | { kind: 'cair' }
    | { kind: 'voltar' }
    | { kind: 'recarregar-jogador'; salvo: boolean }
    | { kind: 'reiniciar-mestre'; salvo: boolean };

  const stepArb: fc.Arbitrary<Step> = fc.oneof(
    {
      weight: 5,
      arbitrary: fc.record({
        kind: fc.constant('editar' as const),
        field: fc.constant('forca' as const),
        value: fc.integer({ min: 1, max: 30 }),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constant('editar' as const),
        field: fc.constant('nome' as const),
        value: fc.string({ maxLength: 8 }),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constant('editar' as const),
        field: fc.constant('envenenado' as const),
        value: fc.boolean(),
      }),
    },
    { weight: 3, arbitrary: fc.constant({ kind: 'cair' as const }) },
    { weight: 2, arbitrary: fc.constant({ kind: 'voltar' as const }) },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant('recarregar-jogador' as const),
        salvo: fc.boolean(),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({ kind: fc.constant('reiniciar-mestre' as const), salvo: fc.boolean() }),
    },
  );

  it('depois de qualquer sequência, o Mestre vê exatamente a ficha local do jogador', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(stepArb, { maxLength: 25 }),
        fc.boolean(),
        async (steps, settleBetween) => {
          const network = new MemoryNetwork();
          let gm = startHost(network);
          let sheet = newSheet('s1', 'ana');
          let player = startPlayer(network, 'ana', sheet);

          for (const step of steps) {
            switch (step.kind) {
              case 'editar':
                sheet = withValue(sheet, step.field, step.value);
                player.client.update(sheet);
                break;
              case 'cair':
                network.disconnect(player.transport);
                break;
              case 'voltar':
                network.connect(player.transport);
                break;
              case 'recarregar-jogador': {
                const saved = step.salvo ? player.client.exportState() : undefined;
                await player.client.stop();
                player = startPlayer(network, 'ana', sheet, saved);
                break;
              }
              case 'reiniciar-mestre': {
                const saved = step.salvo ? gm.host.exportState() : undefined;
                await gm.host.stop();
                gm = startHost(network, saved);
                break;
              }
            }
            if (settleBetween) await network.settle();
          }

          network.connect(player.transport);
          await network.settle();

          expect(player.client.status()).toEqual({ state: 'conectado' });
          const seen = playerSheet(gm.host, 's1')?.sheet;
          expect(seen?.values).toEqual(sheet.values);
          expect(seen?.name).toBe(sheet.name);
        },
      ),
      { numRuns: 500 },
    );
  });
});
