import 'fake-indexeddb/auto';
import { inviteFor } from '@tabula/domain';
import { TabulaDatabase } from '@tabula/storage';
import { MemoryNetwork } from '@tabula/sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServices, type Services } from './services';

let network: MemoryNetwork;
let gmDb: TabulaDatabase;
let playerDb: TabulaDatabase;
let gm: Services;
let player: Services;

beforeEach(() => {
  network = new MemoryNetwork();
  gmDb = new TabulaDatabase(`sessao-mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`sessao-jogador-${crypto.randomUUID()}`);
  // Cada sessão entra na mesma sala simulada.
  const createTransport = () => network.join();
  gm = createServices(gmDb, { createTransport });
  player = createServices(playerDb, { createTransport });
});

afterEach(async () => {
  await gm.session.stop();
  await player.session.stop();
  await network.settle();
  for (const db of [gmDb, playerDb]) {
    db.close();
    await db.delete();
  }
});

/** Espera a rede simulada e as consultas reativas do banco se acomodarem. */
async function eventually(assertion: () => void | Promise<void>) {
  await vi.waitFor(
    async () => {
      await network.settle();
      await assertion();
    },
    { timeout: 3000, interval: 20 },
  );
}

/** Mestre cria a campanha; jogadora entra e cria a ficha vinculada. */
async function setUpTable() {
  const campaign = await gm.campaigns.create({
    name: 'A Mina Perdida',
    templateId: 'dnd5e-srd',
    gmName: 'Paulo',
  });
  await player.campaigns.join(inviteFor(campaign), 'Ana');
  const created = await player.campaigns.createLinkedSheet(campaign.id, 'Lia');
  if (!created.ok) throw new Error(created.error.message);
  return { campaign, sheet: created.value };
}

const gmPlayers = () => {
  const snapshot = gm.session.getSnapshot();
  return snapshot.kind === 'mestre' ? snapshot.players : [];
};

describe('sessão ao vivo', () => {
  it('o Mestre vê a jogadora entrar com a ficha', async () => {
    const { campaign, sheet } = await setUpTable();
    expect(await gm.session.startAsGameMaster(campaign.id)).toEqual({ ok: true, value: undefined });
    expect(await player.session.joinAsPlayer(campaign.id)).toEqual({ ok: true, value: undefined });

    await eventually(() => {
      expect(player.session.getSnapshot()).toMatchObject({
        kind: 'jogador',
        status: { state: 'conectado' },
      });
      expect(gmPlayers()).toEqual([
        expect.objectContaining({
          sheetId: sheet.id,
          displayName: 'Ana',
          online: true,
          sheet: expect.objectContaining({ name: 'Lia', values: sheet.values }),
        }),
      ]);
    });
  });

  it('alterações feitas na ficha chegam ao Mestre', async () => {
    const { campaign, sheet } = await setUpTable();
    await gm.session.startAsGameMaster(campaign.id);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(() => expect(gmPlayers()[0]?.online).toBe(true));

    await player.sheets.setValue(sheet.id, 'hp', { current: 3, max: 10 });
    await player.sheets.setValue(sheet.id, 'condicoes', ['envenenado']);

    await eventually(() =>
      expect(gmPlayers()[0]?.sheet?.values).toMatchObject({
        hp: { current: 3, max: 10 },
        condicoes: ['envenenado'],
      }),
    );
  });

  it('ao encerrar, o estado é salvo e o Mestre reabre vendo a última ficha', async () => {
    const { campaign, sheet } = await setUpTable();
    await gm.session.startAsGameMaster(campaign.id);
    await player.session.joinAsPlayer(campaign.id);
    await player.sheets.setValue(sheet.id, 'for', 18);
    await eventually(() => expect(gmPlayers()[0]?.sheet?.values.for).toBe(18));

    await player.session.stop();
    await gm.session.stop();
    expect(gm.session.getSnapshot()).toEqual({ kind: 'nenhuma' });

    await gm.session.startAsGameMaster(campaign.id);
    await eventually(() =>
      expect(gmPlayers()[0]).toMatchObject({ online: false, sheet: { values: { for: 18 } } }),
    );
  });

  it('jogadora sem ficha vinculada não entra', async () => {
    const campaign = await gm.campaigns.create({
      name: 'Mesa',
      templateId: 'dnd5e-srd',
      gmName: 'Paulo',
    });
    await player.campaigns.join(inviteFor(campaign), 'Ana');
    expect(await player.session.joinAsPlayer(campaign.id)).toMatchObject({
      ok: false,
      error: { code: 'sem-ficha' },
    });
  });

  it('só o Mestre inicia a sessão', async () => {
    const { campaign } = await setUpTable();
    expect(await player.session.startAsGameMaster(campaign.id)).toMatchObject({
      ok: false,
      error: { code: 'nao-e-mestre' },
    });
  });

  it('avisa quem acompanha a sessão a cada mudança', async () => {
    const { campaign } = await setUpTable();
    const listener = vi.fn();
    const unsubscribe = gm.session.subscribe(listener);
    await gm.session.startAsGameMaster(campaign.id);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(() => expect(gmPlayers()[0]?.online).toBe(true));
    unsubscribe();
    expect(listener.mock.calls.length).toBeGreaterThan(1);
  });

  it('excluir a campanha apaga o estado salvo da sessão', async () => {
    const { campaign } = await setUpTable();
    await gm.session.startAsGameMaster(campaign.id);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(() => expect(gmPlayers()[0]?.online).toBe(true));
    await gm.session.stop();
    expect(
      await gmDb.sessionStates.where('campaignId').equals(campaign.id).count(),
    ).toBeGreaterThan(0);

    await gm.campaigns.delete(campaign.id);
    expect(await gmDb.sessionStates.where('campaignId').equals(campaign.id).count()).toBe(0);
  });
});

describe('envio do sistema pelo Mestre', () => {
  const homebrew = {
    id: 'caixa-preta',
    version: '1.0.0',
    name: 'Caixa Preta',
    source: 'local' as const,
    fields: [
      { id: 'vigor', key: 'vigor', label: 'Vigor', type: 'number' as const, default: 2 },
      { id: 'pv', key: 'pv', label: 'PV', type: 'resource' as const, default: 6 },
    ],
    layouts: { full: [], gmSummary: ['pv'] },
  };

  async function homebrewTable() {
    expect(await gm.files.installTemplate(homebrew)).toMatchObject({ ok: true });
    const campaign = await gm.campaigns.create({
      name: 'Mesa caseira',
      templateId: 'caixa-preta',
      gmName: 'Paulo',
    });
    await player.campaigns.join(inviteFor(campaign), 'Ana');
    return campaign;
  }

  /** Resolve a promessa processando a rede simulada enquanto isso. */
  async function whileNetworking<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    void promise.then(() => (done = true));
    for (let i = 0; i < 200 && !done; i++) {
      await network.settle();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return promise;
  }

  it('a jogadora recebe o sistema, cria a ficha e entra na sessão', async () => {
    const campaign = await homebrewTable();
    expect(await player.campaigns.createLinkedSheet(campaign.id, 'Lia')).toMatchObject({
      ok: false,
      error: { code: 'sistema-ausente' },
    });

    await gm.session.startAsGameMaster(campaign.id);
    const receipt = await whileNetworking(player.session.receiveTemplate(campaign.id));
    expect(receipt).toMatchObject({ ok: true, kind: 'template', template: { id: 'caixa-preta' } });
    expect(await player.catalog.get('caixa-preta')).toMatchObject({
      name: 'Caixa Preta',
      source: 'local',
    });

    const created = await player.campaigns.createLinkedSheet(campaign.id, 'Lia');
    expect(created.ok).toBe(true);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(() =>
      expect(gmPlayers()[0]).toMatchObject({
        online: true,
        sheet: { values: { pv: { current: 6, max: 6 } } },
      }),
    );
  });

  it('o pedido pode ser cancelado enquanto espera o Mestre', async () => {
    const campaign = await homebrewTable();
    const controller = new AbortController();
    const pending = player.session.receiveTemplate(campaign.id, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: 'cancelado' });
    expect(await player.catalog.get('caixa-preta')).toBeUndefined();
  });

  it('sistemas nativos não são enviados (todos já têm)', async () => {
    const { campaign } = await setUpTable(); // D&D, nativo
    await gm.session.startAsGameMaster(campaign.id);
    const controller = new AbortController();
    const pending = whileNetworking(player.session.receiveTemplate(campaign.id, controller.signal));
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toEqual({ ok: false, reason: 'cancelado' });
  });
});
