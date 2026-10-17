import { inviteFor, type SystemTemplate } from '@tabula/domain';
import { TabulaDatabase } from '@tabula/storage';
import { MemoryNetwork } from '@tabula/sync';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { createServices, type Services } from './app/services';
import { fakePng, fakeProcessImage } from './testing/fake-images';

let network: MemoryNetwork;
let gmDb: TabulaDatabase;
let playerDb: TabulaDatabase;
let gm: Services;
let player: Services;

beforeEach(() => {
  window.location.hash = '';
  network = new MemoryNetwork();
  gmDb = new TabulaDatabase(`ui-capa-mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`ui-capa-jogador-${crypto.randomUUID()}`);
  const createTransport = () => network.join();
  gm = createServices(gmDb, { createTransport, processImage: fakeProcessImage });
  player = createServices(playerDb, { createTransport, processImage: fakeProcessImage });
});

afterEach(async () => {
  cleanup();
  await gm.session.stop();
  await player.session.stop();
  await network.settle();
  for (const db of [gmDb, playerDb]) {
    db.close();
    await db.delete();
  }
});

/** Sistema mínimo: a ficha completa de D&D pesa nos testes de tela com dois aparelhos. */
const TEMPLATE: SystemTemplate = {
  id: 'capas',
  version: '1.0.0',
  name: 'Sistema de Capas',
  source: 'local',
  fields: [{ id: 'vida', key: 'vida', label: 'Vida', type: 'resource', default: 10 }],
  layouts: { full: [{ kind: 'field', fieldId: 'vida' }] },
};

async function setUpTable() {
  for (const services of [gm, player]) await services.files.installTemplate(TEMPLATE);
  const campaign = await gm.campaigns.create({
    name: 'A Mina Perdida',
    templateId: 'capas',
    gmName: 'Paulo',
  });
  await player.campaigns.join(inviteFor(campaign), 'Ana');
  const created = await player.campaigns.createLinkedSheet(campaign.id, 'Lia');
  if (!created.ok) throw new Error(created.error.message);
  return { campaign, sheet: created.value };
}

/** Espera a interface, processando a rede simulada a cada tentativa. */
const until = (assertion: () => void | Promise<void>) =>
  waitFor(
    async () => {
      await network.settle();
      await assertion();
    },
    { timeout: 4000 },
  );

function renderApp(services: Services, hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App services={services} />);
  return user;
}

const playerCover = async (campaignId: string) =>
  (await player.campaignRepository.get(campaignId))?.cover;

async function connect(campaignId: string) {
  await player.session.joinAsPlayer(campaignId);
  await until(() => {
    expect(player.session.getSnapshot()).toMatchObject({ status: { state: 'conectado' } });
  });
}

describe('capa da campanha', () => {
  it('o Mestre põe, troca e remove a capa; a jogadora online recebe cada mudança', async () => {
    const { campaign } = await setUpTable();
    const user = renderApp(gm, `#/campanhas/${campaign.id}`);
    await user.click(await screen.findByRole('button', { name: 'Iniciar sessão' }));
    await connect(campaign.id);
    await user.click(screen.getByRole('tab', { name: /Campanha/ }));

    await user.upload(
      screen.getByLabelText('Arquivo da capa'),
      new File([fakePng(4000)], 'mina.png', { type: 'image/png' }),
    );
    const cover = await screen.findByRole('img', { name: 'Capa de A Mina Perdida' });
    const first = cover.getAttribute('src');
    expect(first).toMatch(/^data:image\/png;base64,/);
    await until(async () => expect((await playerCover(campaign.id))?.src).toBe(first));

    await user.click(screen.getByRole('button', { name: 'Trocar capa' }));
    await user.upload(
      screen.getByLabelText('Arquivo da capa'),
      new File([fakePng(5000, 3)], 'mina-2.png', { type: 'image/png' }),
    );
    await until(async () => {
      const src = screen.getByRole('img', { name: 'Capa de A Mina Perdida' }).getAttribute('src');
      expect(src).not.toBe(first);
      expect((await playerCover(campaign.id))?.src).toBe(src);
    });

    await user.click(screen.getByRole('button', { name: 'Remover capa' }));
    expect(await screen.findByRole('button', { name: 'Adicionar capa' })).toBeInTheDocument();
    await until(async () => expect(await playerCover(campaign.id)).toBeUndefined());
  });

  it('quem entra depois recebe a capa e a vê na campanha, sem poder trocá-la', async () => {
    const { campaign } = await setUpTable();
    const set = await gm.campaigns.setCover(
      campaign.id,
      new File([fakePng(4000)], 'mina.png', { type: 'image/png' }),
    );
    expect(set.ok).toBe(true);
    await gm.session.startAsGameMaster(campaign.id);
    await connect(campaign.id);
    await until(async () => expect(await playerCover(campaign.id)).toBeDefined());

    renderApp(player, `#/campanhas/${campaign.id}`);
    expect(await screen.findByRole('img', { name: 'Capa de A Mina Perdida' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /capa/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Arquivo da capa')).not.toBeInTheDocument();
  });

  it('só o Mestre escolhe a capa', async () => {
    const { campaign } = await setUpTable();
    const result = await player.campaigns.setCover(
      campaign.id,
      new File([fakePng(4000)], 'mina.png', { type: 'image/png' }),
    );
    expect(result.ok).toBe(false);
    expect(await playerCover(campaign.id)).toBeUndefined();
  });
});
