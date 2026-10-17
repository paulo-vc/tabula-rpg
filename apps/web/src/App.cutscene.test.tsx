import { inviteFor } from '@tabula/domain';
import { TabulaDatabase } from '@tabula/storage';
import { MemoryNetwork } from '@tabula/sync';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
  gmDb = new TabulaDatabase(`ui-cutscene-mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`ui-cutscene-jogador-${crypto.randomUUID()}`);
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

describe('cutscene', () => {
  it('o Mestre adiciona uma imagem e a mostra; a jogadora vê em tela cheia e fecha', async () => {
    const { campaign } = await setUpTable();
    await player.session.joinAsPlayer(campaign.id);
    const user = renderApp(gm, `#/campanhas/${campaign.id}`);
    await user.click(await screen.findByRole('button', { name: 'Iniciar sessão' }));
    await until(() => {
      expect(screen.getByRole('article', { name: 'Jogador Ana' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: /Cutscene/ }));
    const file = new File([fakePng(2000)], 'dragao-vermelho.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Escolher imagem'), file);
    const dialog = await screen.findByRole('dialog', { name: 'Adicionar imagem' });
    expect(within(dialog).getByLabelText('Nome')).toHaveValue('dragao-vermelho');
    await user.clear(within(dialog).getByLabelText('Nome'));
    await user.type(within(dialog).getByLabelText('Nome'), 'O dragão');
    await user.type(within(dialog).getByLabelText('Legenda (opcional)'), 'Ele acorda.');
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    await user.click(await screen.findByRole('button', { name: 'Mostrar O dragão à mesa' }));
    expect(await screen.findByText('O dragão', { selector: 'strong' })).toBeInTheDocument();

    // A jogadora (outro aparelho) recebe a imagem e a vê em tela cheia.
    cleanup();
    const playerUser = renderApp(player, `#/fichas`);
    await until(() => {
      const overlay = screen.getByRole('dialog', { name: 'O dragão' });
      expect(within(overlay).getByRole('img')).toBeInTheDocument();
    });
    const overlay = screen.getByRole('dialog', { name: 'O dragão' });
    expect(within(overlay).getByText('Ele acorda.')).toBeInTheDocument();

    await playerUser.click(within(overlay).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog', { name: 'O dragão' })).not.toBeInTheDocument();
  });

  it('sem sessão, o Mestre guarda imagens mas não consegue mostrar', async () => {
    const { campaign } = await setUpTable();
    await gm.gallery.add(campaign.id, new Blob([fakePng(1000)]), { title: 'Mapa', caption: '' });
    const user = renderApp(gm, `#/campanhas/${campaign.id}`);
    await user.click(await screen.findByRole('tab', { name: /Cutscene/ }));
    expect(await screen.findByRole('button', { name: 'Mostrar Mapa à mesa' })).toBeDisabled();
  });
});
