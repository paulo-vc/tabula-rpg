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
  gmDb = new TabulaDatabase(`ui-bonus-mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`ui-bonus-jogador-${crypto.randomUUID()}`);
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

describe('bônus de itens, maldições e bênçãos', () => {
  it('a jogadora põe +2 de Força por um item; o modificador acompanha, e desligar volta', async () => {
    const sheet = await player.sheets.create({ name: 'Lia', templateId: 'dnd5e-srd' });
    const user = renderApp(player, `#/fichas/${sheet.id}`);
    // Força 10: modificador 0.
    expect(await screen.findByRole('status', { name: 'Mod. Força' })).toHaveTextContent(/^0$/);

    await user.click(screen.getByRole('button', { name: 'Bônus' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bônus e efeitos' });
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar bônus' }));
    await user.type(within(dialog).getByLabelText('Nome'), 'Cinto de Força');
    await user.selectOptions(within(dialog).getByLabelText('Campo 1'), 'Força');
    await user.clear(within(dialog).getByLabelText('Valor 1'));
    await user.type(within(dialog).getByLabelText('Valor 1'), '2');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar bônus' }));

    const list = await within(dialog).findByRole('list', { name: 'Bônus da ficha' });
    expect(list).toHaveTextContent('Cinto de Força (item)');
    expect(list).toHaveTextContent('Força +2');
    await user.keyboard('{Escape}');

    // Força 12 com o cinto: modificador +1, e o campo mostra o valor com bônus.
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Mod. Força' })).toHaveTextContent('+1'),
    );
    expect(screen.getByRole('button', { name: /^Força com bônus: 12/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bônus (1 ativo)' })).toBeInTheDocument();

    // Desligar o bônus volta ao valor de antes.
    await user.click(screen.getByRole('button', { name: 'Bônus (1 ativo)' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Cinto de Força ativo' }));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Cinto de Força ativo' })).not.toBeChecked(),
    );
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Mod. Força' })).toHaveTextContent(/^0$/),
    );
    expect((await player.sheetRepository.get(sheet.id))?.bonuses).toEqual([
      expect.objectContaining({ name: 'Cinto de Força', active: false }),
    ]);
  });

  it('o Mestre aplica uma maldição na ficha da jogadora, que chega na hora', async () => {
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
      const snapshot = gm.session.getSnapshot();
      expect(snapshot.kind === 'mestre' && snapshot.players[0]?.sheet).toBeTruthy();
    });

    const curse = {
      id: 'maldicao',
      name: 'Maldição da lua',
      kind: 'maldicao' as const,
      active: true,
      targets: [{ fieldId: 'for', value: -4 }],
    };
    const result = await gm.session.setPlayerBonuses(campaign.id, created.value.id, [curse]);
    expect(result.ok).toBe(true);

    await until(async () => {
      expect((await player.sheetRepository.get(created.value.id))?.bonuses).toEqual([curse]);
    });
    // Força 6: modificador −2, no card do Mestre também.
    renderApp(gm, `#/campanhas/${campaign.id}/jogadores/${created.value.id}`);
    expect(await screen.findByRole('status', { name: 'Mod. Força' })).toHaveTextContent('−2');
  });

  it('bônus em campo que não existe no sistema é descartado ao chegar', async () => {
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
      const snapshot = gm.session.getSnapshot();
      expect(snapshot.kind === 'mestre' && snapshot.players[0]?.sheet).toBeTruthy();
    });

    await gm.session.setPlayerBonuses(campaign.id, created.value.id, [
      {
        id: 'b',
        name: 'Estranho',
        kind: 'outro',
        active: true,
        targets: [
          { fieldId: 'campo_fantasma', value: 3 },
          { fieldId: 'for', value: 1 },
        ],
      },
    ]);
    await until(async () => {
      expect((await player.sheetRepository.get(created.value.id))?.bonuses).toEqual([
        expect.objectContaining({ targets: [{ fieldId: 'for', value: 1 }] }),
      ]);
    });
  });
});
