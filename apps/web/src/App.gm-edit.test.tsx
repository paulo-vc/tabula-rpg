import { inviteFor, type SystemTemplate } from '@tabula/domain';
import { TabulaDatabase } from '@tabula/storage';
import { MemoryNetwork } from '@tabula/sync';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  gmDb = new TabulaDatabase(`ui-edicao-mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`ui-edicao-jogador-${crypto.randomUUID()}`);
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

const TEMPLATE: SystemTemplate = {
  id: 'mesa-secreta',
  version: '1.0.0',
  name: 'Mesa Secreta',
  source: 'local',
  fields: [
    { id: 'vigor', key: 'vigor', label: 'Vigor', type: 'number', default: 2 },
    { id: 'maldicao', key: 'maldicao', label: 'Maldição', type: 'text', visibility: 'gm' },
  ],
  layouts: {
    full: [
      {
        kind: 'section',
        title: 'Ficha',
        columns: 2,
        children: [
          { kind: 'field', fieldId: 'vigor' },
          { kind: 'field', fieldId: 'maldicao' },
        ],
      },
    ],
  },
};

async function setUpLiveTable() {
  for (const services of [gm, player]) await services.files.installTemplate(TEMPLATE);
  const campaign = await gm.campaigns.create({
    name: 'Segredos',
    templateId: TEMPLATE.id,
    gmName: 'Paulo',
  });
  await player.campaigns.join(inviteFor(campaign), 'Ana');
  const created = await player.campaigns.createLinkedSheet(campaign.id, 'Lia');
  if (!created.ok) throw new Error(created.error.message);
  await gm.session.startAsGameMaster(campaign.id);
  await player.session.joinAsPlayer(campaign.id);
  await waitFor(async () => {
    await network.settle();
    const snapshot = gm.session.getSnapshot();
    expect(snapshot.kind === 'mestre' && snapshot.players[0]?.sheet).toBeTruthy();
  });
  return { campaign, sheet: created.value };
}

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

describe('o Mestre edita a ficha da jogadora', () => {
  it('pelo card abre a ficha, altera um valor e ele chega à jogadora', async () => {
    const { campaign, sheet } = await setUpLiveTable();
    const user = renderApp(gm, `#/campanhas/${campaign.id}`);

    await user.click(await screen.findByRole('link', { name: 'Abrir ficha de Lia' }));
    const vigor = await screen.findByRole('textbox', { name: 'Vigor' });
    await user.clear(vigor);
    await user.type(vigor, '7');

    await until(async () => expect((await playerDb.sheets.get(sheet.id))?.values.vigor).toBe(7));
    expect(screen.getByText(/aparecem para o jogador na hora/)).toBeInTheDocument();
  });

  it('o campo secreto aparece marcado para o Mestre e fica só com ele', async () => {
    const { campaign, sheet } = await setUpLiveTable();
    const user = renderApp(gm, `#/campanhas/${campaign.id}/jogadores/${sheet.id}`);

    expect(await screen.findByText('Só o Mestre vê')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Maldição' }), 'Licantropia');
    await waitFor(async () =>
      expect(await gm.session.secretValues(campaign.id, sheet.id)).toEqual({
        maldicao: 'Licantropia',
      }),
    );
    await network.settle();
    expect((await playerDb.sheets.get(sheet.id))?.values.maldicao).not.toBe('Licantropia');
  });

  it('sem a sessão aberta, a ficha do jogador não abre', async () => {
    const { campaign, sheet } = await setUpLiveTable();
    await gm.session.stop();
    renderApp(gm, `#/campanhas/${campaign.id}/jogadores/${sheet.id}`);
    expect(await screen.findByText(/Abra a sessão da campanha/)).toBeInTheDocument();
  });
});

describe('a jogadora', () => {
  it('não vê o campo secreto e é avisada quando o Mestre altera a ficha', async () => {
    const { campaign, sheet } = await setUpLiveTable();
    renderApp(player, `#/fichas/${sheet.id}`);

    expect(await screen.findByRole('textbox', { name: 'Vigor' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Maldição' })).not.toBeInTheDocument(),
    );

    await gm.session.setPlayerValue(campaign.id, sheet.id, 'vigor', 11);
    await until(() => {
      expect(screen.getByRole('textbox', { name: 'Vigor' })).toHaveValue('11');
    });
    expect(await screen.findByText('O Mestre alterou sua ficha')).toBeInTheDocument();
  });

  it('a ficha fora de campanha mostra todos os campos', async () => {
    await player.files.installTemplate(TEMPLATE);
    const own = await player.sheets.create({ name: 'Solo', templateId: TEMPLATE.id });
    renderApp(player, `#/fichas/${own.id}`);
    expect(await screen.findByRole('textbox', { name: 'Maldição' })).toBeInTheDocument();
  });
});
