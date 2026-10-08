import type { CharacterSheet, FieldValue } from '@tabula/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SessionClient, type RemoteChanges } from './client';
import { SessionHost, type SavedSheetState } from './host';
import { MemoryNetwork, type MemoryTransport } from './memory-transport';
import { newSheet, TEMPLATE, withValue } from './test-helpers';

const CAMPAIGN = { id: 'campanha', gmId: 'mestre', gmName: 'Paulo', templateId: TEMPLATE.id };

function startHost(network: MemoryNetwork, saved?: Map<string, SavedSheetState>) {
  const host = new SessionHost(network.join(), CAMPAIGN, saved);
  host.start();
  return host;
}

/**
 * Jogador com "banco local": o que o Mestre altera é gravado na ficha local, e a ficha
 * local volta para o cliente (como faz o app, que observa o banco).
 */
class Player {
  sheet: CharacterSheet;
  client!: SessionClient;
  transport!: MemoryTransport;
  received: RemoteChanges[] = [];

  constructor(
    private readonly network: MemoryNetwork,
    sheet: CharacterSheet,
  ) {
    this.sheet = sheet;
  }

  start(saved?: Uint8Array): this {
    this.transport = this.network.join();
    this.client = new SessionClient(
      this.transport,
      CAMPAIGN,
      { userId: this.sheet.ownerId, displayName: this.sheet.ownerId },
      this.sheet,
      saved,
      {
        onRemoteChange: (changes) => {
          this.received.push(changes);
          this.sheet = { ...this.sheet, values: { ...this.sheet.values, ...changes } };
          this.client.update(this.sheet);
        },
      },
    );
    this.client.start();
    return this;
  }

  edit(fieldId: string, value: FieldValue): void {
    this.sheet = withValue(this.sheet, fieldId, value);
    this.client.update(this.sheet);
  }

  async reload(withSavedState: boolean): Promise<void> {
    const saved = withSavedState ? this.client.exportState() : undefined;
    await this.client.stop();
    this.start(saved);
  }
}

const seenByGm = (host: SessionHost, sheetId = 's1') =>
  host.players().find((p) => p.sheetId === sheetId)?.sheet?.values;

describe('o Mestre altera a ficha do jogador', () => {
  it('online: a alteração chega à ficha local do jogador', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    const player = new Player(network, newSheet('s1', 'ana')).start();
    await network.settle();

    expect(host.setValues('s1', { hp: { current: 4, max: 10 }, envenenado: true })).toBe(true);
    await network.settle();

    expect(player.received).toEqual([{ hp: { current: 4, max: 10 }, envenenado: true }]);
    expect(player.sheet.values).toMatchObject({ hp: { current: 4, max: 10 }, envenenado: true });
    expect(seenByGm(host)).toEqual(player.sheet.values);
  });

  it('valor igual ao atual não gera tráfego nem aviso', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    const player = new Player(network, newSheet('s1', 'ana')).start();
    await network.settle();
    host.setValues('s1', { forca: 10 });
    await network.settle();
    expect(player.received).toEqual([]);
  });

  it('o jogador e o Mestre editam campos diferentes ao mesmo tempo: os dois valem', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    const player = new Player(network, newSheet('s1', 'ana')).start();
    await network.settle();

    player.edit('forca', 18);
    host.setValues('s1', { envenenado: true });
    await network.settle();

    expect(player.sheet.values).toMatchObject({ forca: 18, envenenado: true });
    expect(seenByGm(host)).toEqual(player.sheet.values);
  });

  it('offline: a alteração espera e chega quando o jogador volta', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    const player = new Player(network, newSheet('s1', 'ana')).start();
    await network.settle();

    network.disconnect(player.transport);
    await network.settle();
    host.setValues('s1', { hp: { current: 1, max: 10 } });
    // Enquanto isso, o jogador mexe em outro campo, offline.
    player.edit('forca', 12);
    await player.reload(true);
    await network.settle();

    expect(player.sheet.values).toMatchObject({ hp: { current: 1, max: 10 }, forca: 12 });
    expect(seenByGm(host)).toEqual(player.sheet.values);
  });

  it('a alteração sobrevive ao Mestre fechar e reabrir a sessão', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    const player = new Player(network, newSheet('s1', 'ana')).start();
    await network.settle();
    network.disconnect(player.transport);
    await network.settle();

    host.setValues('s1', { envenenado: true });
    const saved = host.exportState();
    await host.stop();
    const reopened = startHost(network, saved);
    await player.reload(true);
    await network.settle();

    expect(player.sheet.values).toMatchObject({ envenenado: true });
    expect(seenByGm(reopened)).toEqual(player.sheet.values);
  });

  it('primeira conexão sem estado salvo: a ficha local prevalece', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    const player = new Player(network, withValue(newSheet('s1', 'ana'), 'forca', 15)).start();
    await network.settle();
    network.disconnect(player.transport);
    await network.settle();
    host.setValues('s1', { forca: 3 });

    // O jogador perdeu o estado salvo (outro navegador, dados apagados): a ficha dele vale.
    await player.reload(false);
    await network.settle();
    expect(player.received).toEqual([]);
    expect(player.sheet.values).toMatchObject({ forca: 15 });
    expect(seenByGm(host)).toEqual(player.sheet.values);
  });

  it('ficha desconhecida não é alterada', () => {
    const host = startHost(new MemoryNetwork());
    expect(host.setValues('nao-existe', { forca: 1 })).toBe(false);
  });

  it('valores fora do formato vindos da rede são descartados', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    const player = new Player(network, newSheet('s1', 'ana')).start();
    await network.settle();
    host.setValues('s1', { forca: { invalido: Symbol.for('x') } as never, envenenado: true });
    await network.settle();
    expect(player.received.flatMap((c) => Object.keys(c))).toEqual(['envenenado']);
  });
});

describe('convergência com edições dos dois lados', () => {
  const field = fc.constantFrom('forca', 'envenenado', 'nome');
  const valueFor = (name: string, n: number): FieldValue =>
    name === 'forca' ? n : name === 'envenenado' ? n % 2 === 0 : `v${n}`;

  const step = fc.oneof(
    {
      weight: 4,
      arbitrary: fc.record({ kind: fc.constant('jogador' as const), field, n: fc.nat(99) }),
    },
    {
      weight: 4,
      arbitrary: fc.record({ kind: fc.constant('mestre' as const), field, n: fc.nat(99) }),
    },
    { weight: 2, arbitrary: fc.constant({ kind: 'cair' as const }) },
    { weight: 2, arbitrary: fc.constant({ kind: 'voltar' as const }) },
    {
      weight: 2,
      arbitrary: fc.record({ kind: fc.constant('recarregar' as const), salvo: fc.boolean() }),
    },
    {
      weight: 1,
      arbitrary: fc.record({ kind: fc.constant('reiniciar-mestre' as const), salvo: fc.boolean() }),
    },
  );

  it('depois de qualquer sequência, Mestre e jogador veem a mesma ficha', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 25 }), fc.boolean(), async (steps, settle) => {
        const network = new MemoryNetwork();
        let host = startHost(network);
        const player = new Player(network, newSheet('s1', 'ana')).start();

        for (const s of steps) {
          switch (s.kind) {
            case 'jogador':
              player.edit(s.field, valueFor(s.field, s.n));
              break;
            case 'mestre':
              host.setValues('s1', { [s.field]: valueFor(s.field, s.n) });
              break;
            case 'cair':
              network.disconnect(player.transport);
              break;
            case 'voltar':
              network.connect(player.transport);
              break;
            case 'recarregar':
              await player.reload(s.salvo);
              break;
            case 'reiniciar-mestre': {
              const saved = s.salvo ? host.exportState() : undefined;
              await host.stop();
              host = startHost(network, saved);
              break;
            }
          }
          if (settle) await network.settle();
        }

        network.connect(player.transport);
        await network.settle();
        expect(player.client.status()).toEqual({ state: 'conectado' });
        expect(seenByGm(host)).toEqual(player.sheet.values);
      }),
      { numRuns: 400 },
    );
  });

  it('com o jogador conectado, a última alteração do Mestre sempre chega', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(field, fc.nat(99)), { minLength: 1, maxLength: 10 }),
        async (edits) => {
          const network = new MemoryNetwork();
          const host = startHost(network);
          const player = new Player(network, newSheet('s1', 'ana')).start();
          await network.settle();
          for (const [name, n] of edits) host.setValues('s1', { [name]: valueFor(name, n) });
          await network.settle();
          for (const [name] of edits) {
            const last = [...edits].reverse().find(([other]) => other === name) as [string, number];
            expect(player.sheet.values[name]).toEqual(valueFor(name, last[1]));
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
