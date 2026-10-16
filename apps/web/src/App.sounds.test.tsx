import { inviteFor, type SoundCue, type SystemTemplate } from '@tabula/domain';
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
/** Os sons que a jogadora ouviu (e o volume). */
let heard: [SoundCue, number][];

beforeEach(() => {
  window.location.hash = '';
  network = new MemoryNetwork();
  gmDb = new TabulaDatabase(`ui-sons-mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`ui-sons-jogador-${crypto.randomUUID()}`);
  const createTransport = () => network.join();
  // Dados previsíveis: sempre 4.
  gm = createServices(gmDb, { createTransport, dieRoller: () => 4 });
  heard = [];
  player = createServices(playerDb, {
    createTransport,
    dieRoller: () => 4,
    soundPlayer: { play: (cue, volume) => heard.push([cue, volume]) },
  });
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
  id: 'sons',
  version: '1.0.0',
  name: 'Sistema de Sons',
  source: 'local',
  fields: [{ id: 'vida', key: 'vida', label: 'Vida', type: 'resource', default: 10 }],
  layouts: { full: [{ kind: 'field', fieldId: 'vida' }] },
};

async function setUpLiveTable() {
  for (const services of [gm, player]) await services.files.installTemplate(TEMPLATE);
  const campaign = await gm.campaigns.create({
    name: 'A Mina Perdida',
    templateId: 'sons',
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

const cues = () => heard.map(([cue]) => cue);

describe('sons', () => {
  it('a jogadora ouve a mesa em qualquer tela: mensagem, sussurro, rolagem e a sua vez', async () => {
    const { campaign, sheet } = await setUpLiveTable();
    renderApp(player, `#/fichas/${sheet.id}`);
    await screen.findByRole('button', { name: 'Abrir chat' });

    await gm.session.say({ text: 'Vocês ouvem passos.' });
    await until(() => expect(cues()).toEqual(['mensagem']));
    await gm.session.say({
      text: 'Só você percebe o vulto.',
      to: { id: sheet.ownerId, name: 'Ana' },
    });
    await until(() => expect(cues()).toEqual(['mensagem', 'sussurro']));
    await gm.session.roll({ label: 'Emboscada', expression: '1d20' });
    await until(() => expect(cues()).toEqual(['mensagem', 'sussurro', 'rolagem']));

    // A vez dela chega com a ficha aberta (fora da página da campanha): aviso e som.
    gm.session.updateInitiative(campaign.id, () => ({
      phase: 'combate',
      round: 1,
      activeId: sheet.id,
      combatants: [
        {
          id: sheet.id,
          name: 'Lia',
          initiative: 14,
          kind: 'jogador',
          userId: sheet.ownerId,
          hidden: false,
        },
        { id: 'orc', name: 'Orc', initiative: 9, kind: 'npc', hidden: false },
      ],
    }));
    await until(() => {
      expect(screen.getByText('É a sua vez!')).toBeInTheDocument();
    });
    expect(cues()).toEqual(['mensagem', 'sussurro', 'rolagem', 'sua-vez']);
    expect(heard.every(([, volume]) => volume === 0.5)).toBe(true);
  });

  it('desligar os sons no cabeçalho silencia os avisos; "Testar" toca mesmo assim', async () => {
    const { campaign } = await setUpLiveTable();
    const user = renderApp(player, '#/');

    await user.click(await screen.findByRole('button', { name: 'Sons' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Tocar sons' }));
    expect(await screen.findByRole('button', { name: 'Sons desligados' })).toBeInTheDocument();
    expect(await player.sounds.settings()).toEqual({ enabled: false, volume: 0.5 });

    await gm.session.say({ text: 'Alguém aí?' });
    await until(async () => expect(await player.session.chat(campaign.id)).toHaveLength(1));
    expect(cues()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Testar o som' }));
    await waitFor(() => expect(cues()).toEqual(['sua-vez']));
  });

  it('o volume escolhido vale para os avisos', async () => {
    await setUpLiveTable();
    await player.sounds.update({ volume: 0.2 });
    renderApp(player, '#/');
    await screen.findByRole('button', { name: 'Sons' });
    await gm.session.say({ text: 'Mais baixo.' });
    await until(() => expect(heard).toEqual([['mensagem', 0.2]]));
  });
});
