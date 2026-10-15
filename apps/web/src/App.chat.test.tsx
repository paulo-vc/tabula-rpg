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
  gmDb = new TabulaDatabase(`ui-chat-mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`ui-chat-jogador-${crypto.randomUUID()}`);
  const createTransport = () => network.join();
  // Dados previsíveis: sempre 4.
  gm = createServices(gmDb, { createTransport, dieRoller: () => 4 });
  player = createServices(playerDb, { createTransport, dieRoller: () => 4 });
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

async function setUpLiveTable() {
  const campaign = await gm.campaigns.create({
    name: 'A Mina Perdida',
    templateId: 'dnd5e-srd',
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

describe('chat da sessão', () => {
  it('fora da sessão, o chat não aparece', async () => {
    renderApp(player, '#/');
    await screen.findByRole('heading', { name: /fichas/i });
    expect(screen.queryByRole('button', { name: /Abrir chat/ })).not.toBeInTheDocument();
  });

  it('a jogadora lê a mesa, fala como a personagem, descreve ação, rola e sussurra', async () => {
    const { campaign, sheet } = await setUpLiveTable();
    const user = renderApp(player, `#/fichas/${sheet.id}`);

    // O Mestre fala antes de ela abrir o chat: o botão mostra a novidade.
    await gm.session.say({ text: 'Vocês chegam à entrada da mina.' });
    await until(() => {
      expect(screen.getByRole('button', { name: 'Abrir chat (1 novas)' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Abrir chat (1 novas)' }));
    const panel = screen.getByRole('region', { name: 'Chat da sessão' });
    const feed = await within(panel).findByRole('list', { name: 'Mensagens do chat' });
    expect(feed).toHaveTextContent('Paulo: Vocês chegam à entrada da mina.');

    const input = within(panel).getByLabelText('Mensagem');
    await user.click(within(panel).getByRole('button', { name: 'Como Lia' }));
    await user.type(input, 'Eu vou na frente.{Enter}');
    await user.type(input, '/me acende a tocha{Enter}');
    await user.type(input, '/r 1d20+2 Percepção{Enter}');
    await waitFor(() => expect(feed).toHaveTextContent('Percepção'));
    expect(feed).toHaveTextContent('Lia (Ana): Eu vou na frente.');
    expect(feed).toHaveTextContent('Lia acende a tocha (Ana)');
    expect(within(feed).getAllByRole('listitem').at(-1)).toHaveTextContent('6');

    await user.click(within(panel).getByRole('button', { name: 'Como Lia' }));
    await user.selectOptions(within(panel).getByLabelText('Para'), 'Sussurro: Paulo');
    await user.type(input, 'Escondi o mapa.{Enter}');
    await waitFor(() => expect(feed).toHaveTextContent('Sussurro para Paulo'));

    // Tudo chegou ao Mestre, a rolagem pelo registro de rolagens.
    await until(async () => {
      const received = await gm.session.chat(campaign.id);
      expect(received.map((m) => [m.kind, m.text, m.character, m.to])).toEqual([
        ['fala', 'Vocês chegam à entrada da mina.', undefined, undefined],
        ['personagem', 'Eu vou na frente.', 'Lia', undefined],
        ['acao', 'acende a tocha', 'Lia', undefined],
        ['fala', 'Escondi o mapa.', undefined, campaign.gmId],
      ]);
      expect((await gm.session.rolls(campaign.id)).map((r) => r.label)).toEqual(['Percepção']);
    });
  });

  it('o Mestre fala como NPC e sussurra só à jogadora escolhida', async () => {
    const { campaign } = await setUpLiveTable();
    const user = renderApp(gm, `#/campanhas/${campaign.id}`);
    await until(() => {
      expect(screen.getByRole('article', { name: 'Jogador Ana' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Abrir chat' }));
    const panel = screen.getByRole('region', { name: 'Chat da sessão' });
    await user.type(within(panel).getByLabelText('Falar como'), 'Taverneiro');
    await user.type(within(panel).getByLabelText('Mensagem'), 'Bem-vindos!{Enter}');
    await user.clear(within(panel).getByLabelText('Falar como'));
    await user.selectOptions(within(panel).getByLabelText('Para'), 'Sussurro: Ana');
    await user.type(within(panel).getByLabelText('Mensagem'), 'Você ouve um sussurro.{Enter}');

    const anaId = await player.device.getDeviceId();
    await until(async () => {
      const received = await player.session.chat(campaign.id);
      expect(received.map((m) => [m.kind, m.character, m.to, m.text])).toEqual([
        ['personagem', 'Taverneiro', undefined, 'Bem-vindos!'],
        ['fala', undefined, anaId, 'Você ouve um sussurro.'],
      ]);
    });

    // Fechar com Esc volta ao botão.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Chat da sessão' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir chat' })).toBeInTheDocument();
  });

  it('o chat fica guardado e a mesa recebe a conversa ao entrar depois', async () => {
    const { campaign } = await setUpLiveTable();
    await player.session.stop();
    await gm.session.say({ text: 'Enquanto você estava fora…' });
    await player.session.joinAsPlayer(campaign.id);
    await until(async () => {
      expect((await player.session.chat(campaign.id)).map((m) => m.text)).toEqual([
        'Enquanto você estava fora…',
      ]);
    });
  });
});
