import { inviteFor } from '@tabula/domain';
import { TabulaDatabase } from '@tabula/storage';
import { MemoryNetwork } from '@tabula/sync';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { createServices, type Services } from './app/services';

let network: MemoryNetwork;
let gmDb: TabulaDatabase;
let playerDb: TabulaDatabase;
let gm: Services;
let player: Services;

beforeEach(() => {
  window.location.hash = '';
  network = new MemoryNetwork();
  gmDb = new TabulaDatabase(`ui-diario-mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`ui-diario-jogador-${crypto.randomUUID()}`);
  const createTransport = () => network.join();
  gm = createServices(gmDb, { createTransport });
  player = createServices(playerDb, { createTransport });
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

describe('diário da campanha', () => {
  async function writeEntry(
    user: ReturnType<typeof userEvent.setup>,
    title: string,
    text: string,
    shared: boolean,
  ) {
    await user.click(screen.getByRole('button', { name: 'Nova entrada' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova entrada' });
    await user.type(within(dialog).getByLabelText('Título'), title);
    await user.type(within(dialog).getByLabelText('Texto'), text);
    const share = within(dialog).getByRole('checkbox', { name: 'Compartilhar com a mesa' });
    if ((share.getAttribute('aria-checked') === 'true') !== shared) await user.click(share);
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }

  it('o Mestre escreve, compartilha, deixa de compartilhar e apaga', async () => {
    const { campaign } = await setUpTable();
    const user = renderApp(gm, `#/campanhas/${campaign.id}`);
    await user.click(await screen.findByRole('button', { name: 'Iniciar sessão' }));
    await player.session.joinAsPlayer(campaign.id);

    await writeEntry(user, 'Sessão 1', 'A mesa chegou à mina.', true);
    await writeEntry(user, 'O vilão é o prefeito', 'Não contar ainda.', false);

    const list = screen.getByRole('list', { name: 'Entradas do diário' });
    const items = () => within(list).getAllByRole('listitem');
    expect(items().map((li) => li.textContent)).toEqual([
      expect.stringMatching(/O vilão é o prefeito.*Só você/),
      expect.stringMatching(/Sessão 1.*Compartilhada/),
    ]);

    const playerTitles = async () =>
      (await player.journal.list(campaign.id)).map((entry) => entry.title);
    await until(async () => expect(await playerTitles()).toEqual(['Sessão 1']));

    // Deixa de compartilhar: some do aparelho da jogadora.
    await user.click(within(list).getByRole('button', { name: 'Editar Sessão 1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar entrada' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Compartilhar com a mesa' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await until(async () => expect(await playerTitles()).toEqual([]));

    // Apagar pede confirmação.
    await user.click(within(list).getByRole('button', { name: 'Apagar O vilão é o prefeito' }));
    await user.click(await screen.findByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(items()).toHaveLength(1));
  });
});
