import { inviteFor, type SystemTemplate } from '@tabula/domain';
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
  gmDb = new TabulaDatabase(`ui-rolagem-mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`ui-rolagem-jogador-${crypto.randomUUID()}`);
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

const TEMPLATE: SystemTemplate = {
  id: 'dados',
  version: '1.0.0',
  name: 'Sistema de Dados',
  source: 'local',
  checkDice: '2d12',
  fields: [
    { id: 'agil', key: 'agil', label: 'Agilidade', type: 'number', default: 2 },
    {
      id: 'teste',
      key: 'teste',
      label: 'Teste de Agilidade',
      type: 'computed',
      formula: '@agil',
      signed: true,
    },
    { id: 'dano', key: 'dano', label: 'Dano', type: 'dice', default: '1d8+2' },
  ],
  layouts: {
    full: [
      {
        kind: 'section',
        title: 'Ficha',
        columns: 2,
        children: [
          { kind: 'field', fieldId: 'agil' },
          { kind: 'field', fieldId: 'teste' },
          { kind: 'field', fieldId: 'dano' },
        ],
      },
    ],
  },
};

async function setUpLiveTable() {
  for (const services of [gm, player]) await services.files.installTemplate(TEMPLATE);
  const campaign = await gm.campaigns.create({
    name: 'Dados',
    templateId: 'dados',
    gmName: 'Paulo',
  });
  await player.campaigns.join(inviteFor(campaign), 'Ana');
  const created = await player.campaigns.createLinkedSheet(campaign.id, 'Lia');
  if (!created.ok) throw new Error(created.error.message);
  await gm.session.startAsGameMaster(campaign.id);
  await player.session.joinAsPlayer(campaign.id);
  await waitFor(async () => {
    await network.settle();
    expect(player.session.getSnapshot()).toMatchObject({ status: { state: 'conectado' } });
  });
  return { campaign, sheet: created.value };
}

function renderApp(services: Services, hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App services={services} />);
  return user;
}

describe('rolagens pela ficha', () => {
  it('teste com o dado do sistema e dano pelo campo de dados', async () => {
    const { campaign, sheet } = await setUpLiveTable();
    const user = renderApp(player, `#/fichas/${sheet.id}`);

    await user.click(await screen.findByRole('button', { name: 'Rolar Teste de Agilidade' }));
    // 2d12 + 2 com dados sempre 4.
    expect(await screen.findByText('Teste de Agilidade: 10')).toBeInTheDocument();
    expect(screen.getByText('2d12 + 2 → [4, 4] + 2 = 10')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rolar Dano' }));
    expect(await screen.findByText('Dano: 6')).toBeInTheDocument();

    await waitFor(async () => {
      await network.settle();
      expect((await gm.session.rolls(campaign.id)).map((r) => r.label)).toEqual([
        'Teste de Agilidade',
        'Dano',
      ]);
    });
  });

  it('o Mestre vê a rolagem da jogadora no registro da campanha', async () => {
    const { campaign } = await setUpLiveTable();
    renderApp(gm, `#/campanhas/${campaign.id}`);
    expect(await screen.findByText('Nenhuma rolagem ainda.')).toBeInTheDocument();

    await player.session.roll({ label: 'Furtividade', expression: '1d20+3' });
    await waitFor(async () => {
      await network.settle();
      const list = screen.getByRole('list', { name: 'Registro de rolagens' });
      expect(within(list).getByText(/Furtividade/)).toBeInTheDocument();
      expect(within(list).getByText('7')).toBeInTheDocument();
    });
    // Aviso de rolagem de outra pessoa.
    expect(await screen.findByText('Ana · Furtividade: 7')).toBeInTheDocument();
  });

  it('rolagem secreta do Mestre aparece marcada só para ele', async () => {
    const { campaign } = await setUpLiveTable();
    const user = renderApp(gm, `#/campanhas/${campaign.id}`);

    const input = await screen.findByLabelText('Rolagem livre');
    await user.clear(input);
    await user.type(input, '3d6');
    await user.click(screen.getByRole('checkbox', { name: 'Secreta' }));
    await user.click(screen.getByRole('button', { name: 'Rolar' }));

    const list = await screen.findByRole('list', { name: 'Registro de rolagens' });
    expect(within(list).getByText('12')).toBeInTheDocument();
    expect(within(list).getByText('Secreta')).toBeInTheDocument();
    await network.settle();
    expect(await player.session.rolls(campaign.id)).toEqual([]);
  });

  it('expressão inválida avisa e não registra', async () => {
    const { campaign } = await setUpLiveTable();
    const user = renderApp(player, `#/campanhas/${campaign.id}`);
    const input = await screen.findByLabelText('Rolagem livre');
    await user.clear(input);
    await user.type(input, '1d20*2');
    await user.click(screen.getByRole('button', { name: 'Rolar' }));
    expect(await screen.findByText('Não foi possível rolar')).toBeInTheDocument();
    expect(await player.session.rolls(campaign.id)).toEqual([]);
  });
});
