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
  gmDb = new TabulaDatabase(`ui-sessao-mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`ui-sessao-jogador-${crypto.randomUUID()}`);
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
const until = (assertion: () => void) =>
  waitFor(
    async () => {
      await network.settle();
      assertion();
    },
    { timeout: 4000 },
  );

function renderApp(services: Services, hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App services={services} />);
  return user;
}

describe('painel do Mestre', () => {
  it('abre a sessão e vê a ficha da jogadora atualizar ao vivo', async () => {
    const { campaign, sheet } = await setUpTable();
    const user = renderApp(gm, `#/campanhas/${campaign.id}`);

    await user.click(await screen.findByRole('button', { name: 'Iniciar sessão' }));
    expect(await screen.findByText(/Ao vivo · 0 online/)).toBeInTheDocument();
    expect(screen.getByText(/Aguardando jogadores/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sessão ao vivo/ })).toBeInTheDocument(); // cabeçalho

    await player.session.joinAsPlayer(campaign.id);
    await until(() =>
      expect(screen.getByRole('article', { name: 'Jogador Ana' })).toBeInTheDocument(),
    );

    const card = () => within(screen.getByRole('article', { name: 'Jogador Ana' }));
    expect(card().getByText('Lia')).toBeInTheDocument();
    expect(card().getByText('Online')).toBeInTheDocument();
    expect(card().getByRole('meter', { name: 'Pontos de Vida: 10 de 10' })).toBeInTheDocument();

    await player.sheets.setValue(sheet.id, 'hp', { current: 3, max: 10 });
    await player.sheets.setValue(sheet.id, 'condicoes', ['envenenado', 'caido']);
    await until(() => {
      expect(card().getByRole('meter', { name: 'Pontos de Vida: 3 de 10' })).toBeInTheDocument();
      expect(card().getByText('Caído, Envenenado')).toBeInTheDocument();
    });

    await player.session.stop();
    await until(() => expect(card().getByText('Offline')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Encerrar sessão' }));
    expect(await screen.findByRole('button', { name: 'Iniciar sessão' })).toBeInTheDocument();
  });
});

describe('jogadora', () => {
  it('entra na sessão e vê o status mudar quando o Mestre abre', async () => {
    const { campaign } = await setUpTable();
    const user = renderApp(player, `#/campanhas/${campaign.id}`);

    await user.click(await screen.findByRole('button', { name: 'Entrar na sessão' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Procurando o Mestre');
    expect(screen.getByRole('link', { name: /Conectando à sessão/ })).toBeInTheDocument();

    await gm.session.startAsGameMaster(campaign.id);
    await until(() => expect(screen.getByRole('status')).toHaveTextContent('Conectado'));
    expect(screen.getByRole('link', { name: /Na sessão/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sair da sessão' }));
    expect(await screen.findByRole('button', { name: 'Entrar na sessão' })).toBeInTheDocument();
  });

  it('sem ficha vinculada, o botão de entrar fica desabilitado', async () => {
    const campaign = await gm.campaigns.create({
      name: 'Mesa',
      templateId: 'dnd5e-srd',
      gmName: 'Paulo',
    });
    await player.campaigns.join(inviteFor(campaign), 'Ana');
    renderApp(player, `#/campanhas/${campaign.id}`);
    expect(await screen.findByRole('button', { name: 'Entrar na sessão' })).toBeDisabled();
  });
});

describe('sistema que a jogadora não tem', () => {
  it('recebe do Mestre pela interface e já pode criar a ficha', async () => {
    await gm.files.installTemplate({
      id: 'caixa-preta',
      version: '1.0.0',
      name: 'Caixa Preta',
      source: 'local',
      fields: [{ id: 'pv', key: 'pv', label: 'PV', type: 'resource', default: 6 }],
      layouts: { full: [] },
    });
    const campaign = await gm.campaigns.create({
      name: 'Mesa caseira',
      templateId: 'caixa-preta',
      gmName: 'Paulo',
    });
    await player.campaigns.join(inviteFor(campaign), 'Ana');
    await gm.session.startAsGameMaster(campaign.id);

    const user = renderApp(player, `#/campanhas/${campaign.id}`);
    await user.click(await screen.findByRole('button', { name: 'Receber do Mestre' }));
    expect(screen.getByText('Aguardando o Mestre…')).toBeInTheDocument();

    await until(() => expect(screen.getByLabelText('Crie sua ficha')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Receber do Mestre' })).not.toBeInTheDocument();
  });
});
