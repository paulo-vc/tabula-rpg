import { inviteFor } from '@tabula/domain';
import { TabulaDatabase } from '@tabula/storage';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { encodeInvite } from './app/invite-link';
import { createServices, type Services } from './app/services';

/** Dois dispositivos: o do Mestre e o da jogadora, cada um com seu banco. */
let gmDb: TabulaDatabase;
let playerDb: TabulaDatabase;
let gm: Services;
let player: Services;

beforeEach(() => {
  window.location.hash = '';
  gmDb = new TabulaDatabase(`ui-mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`ui-jogador-${crypto.randomUUID()}`);
  gm = createServices(gmDb);
  player = createServices(playerDb);
});

afterEach(async () => {
  cleanup();
  for (const db of [gmDb, playerDb]) {
    db.close();
    await db.delete();
  }
});

function renderApp(services: Services, hash = '') {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App services={services} />);
  return user;
}

async function campaignInviteCode() {
  const campaign = await gm.campaigns.create({
    name: 'A Mina Perdida',
    templateId: 'dnd5e-srd',
    gmName: 'Paulo',
  });
  return { campaign, code: encodeInvite(inviteFor(campaign)) };
}

describe('Mestre', () => {
  it('cria uma campanha e vê o convite para enviar', async () => {
    const user = renderApp(gm, '#/campanhas');
    await user.click(await screen.findByRole('button', { name: 'Nova campanha' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nome da campanha'), 'A Mina Perdida');
    await user.type(within(dialog).getByLabelText(/Seu nome/), 'Paulo');
    await user.click(within(dialog).getByRole('button', { name: 'Criar campanha' }));

    expect(await screen.findByRole('heading', { name: 'A Mina Perdida' })).toBeInTheDocument();
    expect(screen.getByText('Você é o Mestre')).toBeInTheDocument();
    // Em jsdom o endereço é http://localhost: há link e código.
    expect((screen.getByLabelText('Link') as HTMLInputElement).value).toContain('#/convite/');
    expect((screen.getByLabelText('Ou só o código') as HTMLInputElement).value).toMatch(
      /^[A-Za-z0-9_-]+$/,
    );
  });

  it('a próxima campanha já vem com o nome do Mestre preenchido', async () => {
    await campaignInviteCode();
    const user = renderApp(gm, '#/campanhas');
    await user.click(await screen.findByRole('button', { name: 'Nova campanha' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText(/Seu nome/)).toHaveValue('Paulo'));
  });

  it('lista a campanha com o papel de Mestre', async () => {
    await campaignInviteCode();
    renderApp(gm, '#/campanhas');
    const card = await screen.findByRole('link', { name: /A Mina Perdida/ });
    expect(await within(card).findByText('Mestre')).toBeInTheDocument();
  });
});

describe('Jogadora', () => {
  it('entra pelo link, cria a ficha vinculada e a abre', async () => {
    const { code } = await campaignInviteCode();
    const user = renderApp(player, `#/convite/${code}`);

    expect(await screen.findByRole('heading', { name: 'A Mina Perdida' })).toBeInTheDocument();
    expect(screen.getByText(/Mestre: Paulo · Sistema: D&D 5ª Edição/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Seu nome/), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Entrar na campanha' }));

    expect(await screen.findByText('Mestre: Paulo')).toBeInTheDocument();
    await user.type(await screen.findByLabelText('Crie sua ficha'), 'Lia');
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    const open = await screen.findByRole('link', { name: 'Abrir ficha' });
    expect(screen.getByText('Lia')).toBeInTheDocument();
    await user.click(open);
    expect(await screen.findByRole('textbox', { name: 'Nome da ficha' })).toHaveValue('Lia');
  });

  it('entra colando o código e escolhe uma ficha que já tinha', async () => {
    const { code } = await campaignInviteCode();
    await player.sheets.create({ name: 'Thorin', templateId: 'dnd5e-srd' });
    const user = renderApp(player, '#/campanhas');

    await user.click(await screen.findByRole('button', { name: 'Entrar com convite' }));
    const dialog = await screen.findByRole('dialog');
    // Como o usuário real: cola o código (digitar ~400 caracteres seria lento no teste).
    await user.click(within(dialog).getByLabelText('Convite'));
    await user.paste(code);
    await user.click(within(dialog).getByRole('button', { name: 'Continuar' }));

    await user.type(await screen.findByLabelText(/Seu nome/), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Entrar na campanha' }));
    await user.click(await screen.findByRole('button', { name: 'Usar esta' }));

    expect(await screen.findByRole('link', { name: 'Abrir ficha' })).toBeInTheDocument();
    expect(screen.getByText('Thorin')).toBeInTheDocument();
  });

  it('mostra o erro de um convite inválido sem sair do diálogo', async () => {
    const user = renderApp(player, '#/campanhas');
    await user.click(await screen.findByRole('button', { name: 'Entrar com convite' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Convite'), 'isso não é um convite');
    await user.click(within(dialog).getByRole('button', { name: 'Continuar' }));
    expect(within(dialog).getByText('Convite inválido ou incompleto.')).toBeInTheDocument();
  });

  it('abrir o convite de novo leva à campanha, sem entrar duas vezes', async () => {
    const { code } = await campaignInviteCode();
    const user = renderApp(player, `#/convite/${code}`);
    await user.type(await screen.findByLabelText(/Seu nome/), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Entrar na campanha' }));
    await screen.findByText('Mestre: Paulo');

    window.location.hash = `#/convite/${code}`;
    expect(
      await screen.findByText('Esta campanha já está no seu dispositivo.'),
    ).toBeInTheDocument();
    expect(await player.campaignRepository.list()).toHaveLength(1);
  });

  it('sai da campanha mantendo a ficha', async () => {
    const { campaign, code } = await campaignInviteCode();
    const user = renderApp(player, `#/convite/${code}`);
    await user.type(await screen.findByLabelText(/Seu nome/), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Entrar na campanha' }));
    await user.type(await screen.findByLabelText('Crie sua ficha'), 'Lia');
    await user.click(screen.getByRole('button', { name: 'Criar' }));
    await screen.findByRole('link', { name: 'Abrir ficha' });

    await user.click(screen.getByRole('button', { name: /Sair da campanha/ }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sair' }),
    );

    await waitFor(() => expect(window.location.hash).toBe('#/campanhas'));
    expect(await player.campaignRepository.get(campaign.id)).toBeUndefined();
    expect(await player.sheetRepository.list()).toHaveLength(1);
  });
});

it('convite inválido no link mostra uma mensagem clara', async () => {
  renderApp(player, '#/convite/lixo');
  expect(await screen.findByRole('heading', { name: 'Convite inválido' })).toBeInTheDocument();
});
