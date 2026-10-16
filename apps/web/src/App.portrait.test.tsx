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
  gmDb = new TabulaDatabase(`ui-retrato-mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`ui-retrato-jogador-${crypto.randomUUID()}`);
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
  id: 'retratos',
  version: '1.0.0',
  name: 'Sistema de Retratos',
  source: 'local',
  fields: [{ id: 'vida', key: 'vida', label: 'Vida', type: 'resource', default: 10 }],
  layouts: { full: [{ kind: 'field', fieldId: 'vida' }] },
};

async function setUpLiveTable() {
  for (const services of [gm, player]) await services.files.installTemplate(TEMPLATE);
  const campaign = await gm.campaigns.create({
    name: 'A Mina Perdida',
    templateId: 'retratos',
    gmName: 'Paulo',
  });
  await player.campaigns.join(inviteFor(campaign), 'Ana');
  const created = await player.campaigns.createLinkedSheet(campaign.id, 'Lia');
  if (!created.ok) throw new Error(created.error.message);
  await gm.session.startAsGameMaster(campaign.id);
  await player.session.joinAsPlayer(campaign.id);
  await until(() => {
    expect(player.session.getSnapshot()).toMatchObject({ status: { state: 'conectado' } });
  });
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

const gmPortrait = () => {
  const snapshot = gm.session.getSnapshot();
  return snapshot.kind === 'mestre' ? snapshot.players[0]?.sheet?.portrait : undefined;
};

describe('retrato do personagem', () => {
  it('a jogadora escolhe, troca e remove o retrato; o Mestre o recebe pela sessão', async () => {
    const { sheet } = await setUpLiveTable();
    const user = renderApp(player, `#/fichas/${sheet.id}`);

    await user.upload(
      await screen.findByLabelText('Arquivo do retrato'),
      new File([fakePng(2000)], 'lia.png', { type: 'image/png' }),
    );
    const image = await screen.findByRole('img', { name: 'Retrato de Lia' });
    expect(image.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    await until(() => expect(gmPortrait()?.src).toBe(image.getAttribute('src')));

    // Trocar pelo menu do retrato.
    await user.click(screen.getByRole('button', { name: 'Retrato do personagem' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Trocar retrato' }));
    await user.upload(
      screen.getByLabelText('Arquivo do retrato'),
      new File([fakePng(3000, 11)], 'lia-2.png', { type: 'image/png' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Retrato de Lia' }).getAttribute('src')).not.toBe(
        image.getAttribute('src'),
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Retrato do personagem' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remover retrato' }));
    expect(await screen.findByRole('button', { name: 'Escolher retrato' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Retrato de Lia' })).not.toBeInTheDocument();
    await until(() => expect(gmPortrait()).toBeUndefined());
  });

  it('o Mestre vê o retrato no card do jogador', async () => {
    const { campaign, sheet } = await setUpLiveTable();
    const set = await player.sheets.setPortrait(
      sheet.id,
      new File([fakePng(2000)], 'lia.png', { type: 'image/png' }),
    );
    expect(set.ok).toBe(true);
    renderApp(gm, `#/campanhas/${campaign.id}`);
    await until(() => {
      expect(screen.getByRole('img', { name: 'Retrato de Lia' })).toBeInTheDocument();
    });
  });

  it('arquivo que não é imagem é recusado, sem mexer na ficha', async () => {
    const created = await player.sheets.create({ name: 'Lia', templateId: 'dnd5e-srd' });
    const user = renderApp(player, `#/fichas/${created.id}`);
    await user.upload(
      await screen.findByLabelText('Arquivo do retrato'),
      new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'lia.png', { type: 'image/png' }),
    );
    expect(await screen.findByText('Não foi possível usar a imagem')).toBeInTheDocument();
    expect((await player.sheetRepository.get(created.id))?.portrait).toBeUndefined();
  });
});
