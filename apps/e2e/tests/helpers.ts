import { expect, type Browser, type Page } from '@playwright/test';

/**
 * Um aparelho: contexto de navegador próprio (banco, ID do dispositivo e sessão separados),
 * como o computador do Mestre e o celular de um jogador.
 */
export async function newDevice(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/** O Mestre cria a campanha (D&D 5e, o sistema padrão) e fica na página dela. */
export async function createCampaign(gm: Page, name = 'A Mina Perdida', gmName = 'Paulo') {
  await gm.goto('#/campanhas');
  await gm.getByRole('button', { name: 'Nova campanha' }).click();
  await gm.getByLabel('Nome da campanha').fill(name);
  await gm.getByLabel('Seu nome (como os jogadores verão)').fill(gmName);
  await gm.getByRole('button', { name: 'Criar campanha' }).click();
  await expect(gm).toHaveURL(/#\/campanhas\/[\w-]+$/);
}

/** O link de convite que o Mestre copia e manda no grupo. */
export async function inviteLink(gm: Page): Promise<string> {
  const link = await gm.getByLabel('Link', { exact: true }).inputValue();
  expect(link).toContain('#/convite/');
  return link;
}

/** O jogador abre o convite, entra na campanha e cria a ficha vinculada. */
export async function joinWithInvite(
  player: Page,
  link: string,
  playerName: string,
  character: string,
) {
  await player.goto(link);
  await player.getByLabel('Seu nome (como o Mestre verá)').fill(playerName);
  await player.getByRole('button', { name: 'Entrar na campanha' }).click();
  await player.getByLabel('Crie sua ficha').fill(character);
  await player.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(player.getByRole('link', { name: 'Abrir ficha' })).toBeVisible();
}

/** Mestre com a sessão aberta e o jogador conectado a ela (vendo o próprio status). */
export async function startTable(gm: Page, player: Page, playerName: string) {
  await gm.getByRole('button', { name: 'Iniciar sessão' }).click();
  await player.getByRole('button', { name: 'Entrar na sessão' }).click();
  await expect(player.getByText(/Conectado\./)).toBeVisible();
  await expect(gm.getByRole('article', { name: `Jogador ${playerName}` })).toBeVisible();
}
