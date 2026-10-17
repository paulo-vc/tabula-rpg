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

describe('combate', () => {
  it('o Mestre monta a ordem pela tela; um oculto não aparece para a jogadora', async () => {
    const { campaign } = await setUpTable();
    const user = renderApp(gm, `#/campanhas/${campaign.id}`);
    await user.click(await screen.findByRole('button', { name: 'Iniciar sessão' }));
    await player.session.joinAsPlayer(campaign.id);
    await until(() =>
      expect(screen.getByRole('article', { name: 'Jogador Ana' })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Iniciar combate' }));
    const lia = screen.getByRole('textbox', { name: 'Iniciativa de Lia' });
    await user.clear(lia);
    await user.type(lia, '14{Enter}');

    await user.type(screen.getByRole('textbox', { name: 'Criatura' }), 'Goblin');
    await user.type(screen.getByRole('textbox', { name: 'Iniciativa' }), '18');
    await user.click(screen.getByRole('checkbox', { name: 'Oculto' }));
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    const order = screen.getByRole('list', { name: 'Ordem de turno' });
    expect(
      within(order)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('Goblin'), expect.stringContaining('Lia')]);

    await user.click(screen.getByRole('button', { name: 'Começar' }));
    expect(within(order).getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step');

    await until(() => {
      const snapshot = player.session.getSnapshot();
      expect(snapshot.kind === 'jogador' && snapshot.initiative).toMatchObject({
        phase: 'combate',
        activeId: null,
        combatants: [expect.objectContaining({ name: 'Lia', initiative: 14 })],
      });
    });

    await user.click(screen.getByRole('button', { name: 'Próximo turno' }));
    expect(within(order).getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step');
  });

  it('com o combate em andamento, o Mestre adiciona e tira criaturas', async () => {
    const { campaign } = await setUpTable();
    const user = renderApp(gm, `#/campanhas/${campaign.id}`);
    await user.click(await screen.findByRole('button', { name: 'Iniciar sessão' }));
    // A sessão abre em segundo plano: o combate aparece quando ela está aberta.
    await user.click(await screen.findByRole('button', { name: 'Iniciar combate' }));
    await user.type(screen.getByRole('textbox', { name: 'Criatura' }), 'Goblin');
    await user.type(screen.getByRole('textbox', { name: 'Iniciativa' }), '5');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    await user.click(screen.getByRole('button', { name: 'Começar' }));
    await user.type(screen.getByRole('textbox', { name: 'Criatura' }), 'Orc');
    await user.type(screen.getByRole('textbox', { name: 'Iniciativa' }), '20');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    const order = screen.getByRole('list', { name: 'Ordem de turno' });
    await waitFor(() => expect(order).toHaveTextContent('Orc'));
    await user.click(screen.getByRole('button', { name: 'Tirar Goblin do combate' }));
    await waitFor(() => expect(order).not.toHaveTextContent('Goblin'));
  });

  it('quem entra na sessão depois do início entra no combate pelo Mestre e rola a iniciativa', async () => {
    const { campaign } = await setUpTable();
    await gm.session.startAsGameMaster(campaign.id);
    gm.session.updateInitiative(campaign.id, () => ({
      phase: 'combate',
      round: 2,
      activeId: 'orc',
      combatants: [{ id: 'orc', name: 'Orc', initiative: 12, kind: 'npc', hidden: false }],
    }));
    await player.session.joinAsPlayer(campaign.id);
    const user = renderApp(gm, `#/campanhas/${campaign.id}`);

    await until(() => {
      expect(screen.getByRole('button', { name: 'Adicionar Lia ao combate' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Adicionar Lia ao combate' }));
    const order = screen.getByRole('list', { name: 'Ordem de turno' });
    expect(order).toHaveTextContent('Lia');
    expect(
      screen.queryByRole('button', { name: 'Adicionar Lia ao combate' }),
    ).not.toBeInTheDocument();
    // A vez continua com quem estava.
    expect(within(order).getByText('Orc').closest('li')).toHaveAttribute('aria-current', 'step');

    // A jogadora recebe a ordem com ela, e pode rolar a iniciativa (ainda está com 0).
    await until(() => {
      const snapshot = player.session.getSnapshot();
      expect(snapshot.kind === 'jogador' && snapshot.initiative?.combatants).toContainEqual(
        expect.objectContaining({ name: 'Lia', initiative: 0 }),
      );
    });
    cleanup();
    renderApp(player, `#/campanhas/${campaign.id}`);
    expect(await screen.findByRole('button', { name: /^Rolar iniciativa/ })).toBeInTheDocument();
  });
});

describe('combate, do lado da jogadora', () => {
  it('vê a ordem e o aviso quando é a vez dela', async () => {
    const { campaign, sheet } = await setUpTable();
    await gm.session.startAsGameMaster(campaign.id);
    const user = renderApp(player, `#/campanhas/${campaign.id}`);
    await user.click(await screen.findByRole('button', { name: 'Entrar na sessão' }));
    await until(() => {
      const snapshot = gm.session.getSnapshot();
      expect(snapshot.kind === 'mestre' && snapshot.players[0]?.online).toBe(true);
    });

    gm.session.updateInitiative(campaign.id, () => ({
      phase: 'combate',
      round: 2,
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

    await until(() => expect(screen.getByText('Rodada 2')).toBeInTheDocument());
    expect(screen.getAllByText('É a sua vez!').length).toBeGreaterThan(0);
    const order = screen.getByRole('list', { name: 'Ordem de turno' });
    expect(within(order).getByText('Você')).toBeInTheDocument();
    expect(within(order).getByText('Orc')).toBeInTheDocument();
  });
});

describe('iniciativa pela ficha', () => {
  it('a jogadora rola a iniciativa no painel de combate e ela entra na ordem do Mestre', async () => {
    const { campaign, sheet } = await setUpTable();
    await gm.session.startAsGameMaster(campaign.id);
    const user = renderApp(player, `#/campanhas/${campaign.id}`);
    await user.click(await screen.findByRole('button', { name: 'Entrar na sessão' }));
    await until(() => {
      const snapshot = gm.session.getSnapshot();
      expect(snapshot.kind === 'mestre' && snapshot.players[0]?.online).toBe(true);
    });
    gm.session.updateInitiative(campaign.id, () => ({
      phase: 'preparando',
      round: 1,
      activeId: null,
      combatants: [
        {
          id: sheet.id,
          name: 'Lia',
          initiative: 0,
          kind: 'jogador',
          userId: sheet.ownerId,
          hidden: false,
        },
      ],
    }));

    // D&D: Destreza 10 (modificador 0), então a rolagem é só o dado dos testes.
    // A ordem chega pela rede (simulada) antes do botão aparecer.
    await until(() => expect(screen.getByText('Preparando')).toBeInTheDocument());
    const roll = await screen.findByRole('button', { name: 'Rolar iniciativa (1d20)' });
    await user.click(roll);
    await until(() => {
      const snapshot = gm.session.getSnapshot();
      const lia = snapshot.kind === 'mestre' ? snapshot.initiative?.combatants[0] : undefined;
      expect(lia?.initiative).toBeGreaterThanOrEqual(1);
      expect(lia?.initiative).toBeLessThanOrEqual(20);
    });
  });
});

describe('iniciativa das criaturas', () => {
  it('com modificador e quantidade, cada criatura rola a sua, em segredo', async () => {
    const { campaign } = await setUpTable();
    const user = renderApp(gm, `#/campanhas/${campaign.id}`);
    await user.click(await screen.findByRole('button', { name: 'Iniciar sessão' }));
    await player.session.joinAsPlayer(campaign.id);
    await user.click(await screen.findByRole('button', { name: 'Iniciar combate' }));

    await user.type(screen.getByRole('textbox', { name: 'Criatura' }), 'Goblin');
    await user.type(screen.getByRole('textbox', { name: 'Iniciativa' }), '+2');
    const quantity = screen.getByRole('textbox', { name: 'Qtd.' });
    await user.clear(quantity);
    await user.type(quantity, '3');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => {
      const snapshot = gm.session.getSnapshot();
      const goblins =
        snapshot.kind === 'mestre'
          ? (snapshot.initiative?.combatants.filter((c) => c.kind === 'npc') ?? [])
          : [];
      expect(goblins.map((g) => g.name)).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3']);
      for (const goblin of goblins) {
        expect(goblin.initiative).toBeGreaterThanOrEqual(3);
        expect(goblin.initiative).toBeLessThanOrEqual(22);
      }
    });

    // As rolagens ficam só no registro do Mestre (secretas).
    const gmRolls = await gm.session.rolls(campaign.id);
    expect(gmRolls.filter((r) => r.label.startsWith('Iniciativa: Goblin'))).toHaveLength(3);
    expect(gmRolls.every((r) => r.secret)).toBe(true);
    await network.settle();
    expect(await player.session.rolls(campaign.id)).toEqual([]);
  });

  it('o campo recusa o que não é número nem rolagem', async () => {
    const { campaign } = await setUpTable();
    const user = renderApp(gm, `#/campanhas/${campaign.id}`);
    await user.click(await screen.findByRole('button', { name: 'Iniciar sessão' }));
    await user.click(await screen.findByRole('button', { name: 'Iniciar combate' }));
    await user.type(screen.getByRole('textbox', { name: 'Criatura' }), 'Orc');
    const field = screen.getByRole('textbox', { name: 'Iniciativa' });
    await user.type(field, 'muito rápido');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Adicionar' })).toBeDisabled();
  });
});
