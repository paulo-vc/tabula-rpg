import { expect, test } from '@playwright/test';
import { createCampaign, inviteLink, joinWithInvite, newDevice, startTable } from './helpers';

test.describe('mesa ao vivo, de ponta a ponta', () => {
  test('convite, sessão e a ficha da jogadora mudando no painel do Mestre', async ({ browser }) => {
    const gm = await newDevice(browser);
    const player = await newDevice(browser);

    await createCampaign(gm);
    await joinWithInvite(player, await inviteLink(gm), 'Ana', 'Lia');
    await startTable(gm, player, 'Ana');

    const card = gm.getByRole('article', { name: 'Jogador Ana' });
    await expect(card.getByText('Lia', { exact: true })).toBeVisible();
    await expect(card.getByRole('meter', { name: 'Pontos de Vida: 10 de 10' })).toBeVisible();

    // A jogadora toma 4 de dano na própria ficha; o Mestre vê na hora.
    await player.getByRole('link', { name: 'Abrir ficha' }).click();
    const vitals = player.getByRole('region', { name: 'Resumo do personagem' });
    await vitals.getByLabel('Quanto de Pontos de Vida').fill('4');
    await vitals.getByRole('button', { name: 'Dano' }).click();
    await expect(card.getByRole('meter', { name: 'Pontos de Vida: 6 de 10' })).toBeVisible();

    // Uma condição marcada no painel fixo também chega.
    await vitals.getByRole('button', { name: 'Condições' }).click();
    await player
      .getByRole('dialog', { name: 'Condições' })
      .getByRole('button', { name: 'Envenenado' })
      .click();
    await expect(card.getByText('Envenenado')).toBeVisible();
  });

  test('o Mestre altera a ficha da jogadora, e ela vê a mudança', async ({ browser }) => {
    const gm = await newDevice(browser);
    const player = await newDevice(browser);
    await createCampaign(gm);
    await joinWithInvite(player, await inviteLink(gm), 'Ana', 'Lia');
    await startTable(gm, player, 'Ana');
    await player.getByRole('link', { name: 'Abrir ficha' }).click();

    await gm.getByRole('link', { name: 'Abrir ficha de Lia' }).click();
    const strength = gm.getByRole('textbox', { name: 'Força' });
    await strength.fill('18');
    await strength.blur();

    await expect(player.getByRole('textbox', { name: 'Força' })).toHaveValue('18');
    await expect(player.getByRole('status', { name: 'Mod. Força' })).toHaveText('+4');
  });

  test('rolagens aparecem para a mesa; a secreta do Mestre, não', async ({ browser }) => {
    const gm = await newDevice(browser);
    const player = await newDevice(browser);
    await createCampaign(gm);
    await joinWithInvite(player, await inviteLink(gm), 'Ana', 'Lia');
    await startTable(gm, player, 'Ana');

    // 1d1+4 sempre dá 5: o resultado é conhecido sem depender do sorteio.
    const gmLog = gm.getByRole('list', { name: 'Registro de rolagens' });
    await gm.getByLabel('Rolagem livre').fill('1d1+4');
    await gm.getByRole('button', { name: 'Rolar' }).click();
    await expect(gmLog.getByRole('listitem').first()).toContainText('5');

    const playerLog = player.getByRole('list', { name: 'Registro de rolagens' });
    await expect(playerLog.getByRole('listitem').first()).toContainText('Paulo');
    await expect(playerLog.getByRole('listitem').first()).toContainText('5');

    await gm.getByLabel('Rolagem livre').fill('1d1+10');
    await gm.getByRole('checkbox', { name: 'Secreta' }).check();
    await gm.getByRole('button', { name: 'Rolar' }).click();
    await expect(gmLog.getByRole('listitem').first()).toContainText('11');
    // Uma rolagem pública depois prova que a secreta teria tido tempo de chegar.
    await gm.getByRole('checkbox', { name: 'Secreta' }).uncheck();
    await gm.getByLabel('Rolagem livre').fill('1d1+20');
    await gm.getByRole('button', { name: 'Rolar' }).click();
    await expect(playerLog.getByRole('listitem').first()).toContainText('21');
    await expect(playerLog).not.toContainText('1d1 + 10');
  });

  test('combate: a ordem chega à jogadora sem o inimigo oculto, e ela vê a própria vez', async ({
    browser,
  }) => {
    const gm = await newDevice(browser);
    const player = await newDevice(browser);
    await createCampaign(gm);
    await joinWithInvite(player, await inviteLink(gm), 'Ana', 'Lia');
    await startTable(gm, player, 'Ana');

    await gm.getByRole('button', { name: 'Iniciar combate' }).click();
    const lia = gm.getByRole('textbox', { name: 'Iniciativa de Lia' });
    await lia.fill('14');
    await lia.press('Enter');
    await gm.getByRole('textbox', { name: 'Criatura' }).fill('Emboscada');
    await gm.getByRole('textbox', { name: 'Iniciativa', exact: true }).fill('18');
    await gm.getByRole('checkbox', { name: 'Oculto' }).check();
    await gm.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await gm.getByRole('button', { name: 'Começar' }).click();

    const playerOrder = player.getByRole('list', { name: 'Ordem de turno' });
    await expect(player.getByText('Vez do Mestre.')).toBeVisible();
    await expect(playerOrder.getByRole('listitem')).toHaveCount(1);
    await expect(playerOrder).not.toContainText('Emboscada');

    await gm.getByRole('button', { name: 'Próximo turno' }).click();
    await expect(player.getByText('É a sua vez!').first()).toBeVisible();
    await expect(playerOrder.getByRole('listitem').first()).toHaveAttribute('aria-current', 'step');
  });

  test('a jogadora que entra depois, no meio do combate, recebe a ordem atual', async ({
    browser,
  }) => {
    const gm = await newDevice(browser);
    const ana = await newDevice(browser);
    const bia = await newDevice(browser);
    await createCampaign(gm);
    const link = await inviteLink(gm);
    await joinWithInvite(ana, link, 'Ana', 'Lia');
    await joinWithInvite(bia, link, 'Bia', 'Mira');
    await startTable(gm, ana, 'Ana');

    await gm.getByRole('button', { name: 'Iniciar combate' }).click();
    await gm.getByRole('button', { name: 'Começar' }).click();
    await expect(ana.getByText('É a sua vez!').first()).toBeVisible();

    await bia.getByRole('button', { name: 'Entrar na sessão' }).click();
    await expect(bia.getByRole('list', { name: 'Ordem de turno' })).toContainText('Lia');
    await expect(bia.getByText('Vez de Lia.')).toBeVisible();
  });

  test('recarregar a página no meio da sessão retoma a mesa dos dois lados', async ({
    browser,
  }) => {
    const gm = await newDevice(browser);
    const player = await newDevice(browser);
    await createCampaign(gm);
    await joinWithInvite(player, await inviteLink(gm), 'Ana', 'Lia');
    await startTable(gm, player, 'Ana');
    const card = gm.getByRole('article', { name: 'Jogador Ana' });

    await player.reload();
    await expect(player.getByText(/Conectado\./)).toBeVisible();

    await gm.reload();
    await expect(card.getByText('Online')).toBeVisible();

    // A sincronização continua depois das duas recargas.
    await player.getByRole('link', { name: 'Abrir ficha' }).click();
    const vitals = player.getByRole('region', { name: 'Resumo do personagem' });
    await vitals.getByLabel('Quanto de Pontos de Vida').fill('3');
    await vitals.getByRole('button', { name: 'Dano' }).click();
    await expect(card.getByRole('meter', { name: 'Pontos de Vida: 7 de 10' })).toBeVisible();
  });

  test('a jogadora rola a iniciativa pela ficha e o valor entra na ordem do Mestre', async ({
    browser,
  }) => {
    const gm = await newDevice(browser);
    const player = await newDevice(browser);
    await createCampaign(gm);
    await joinWithInvite(player, await inviteLink(gm), 'Ana', 'Lia');
    await startTable(gm, player, 'Ana');

    await gm.getByRole('button', { name: 'Iniciar combate' }).click();
    // D&D com Destreza 10: a rolagem é só o d20.
    await player.getByRole('button', { name: 'Rolar iniciativa (1d20)' }).click();

    const playerLog = player.getByRole('list', { name: 'Registro de rolagens' });
    await expect(playerLog.getByRole('listitem').first()).toContainText('Iniciativa');
    const total = (
      await playerLog.getByRole('listitem').first().locator('span').first().textContent()
    )?.trim();
    expect(Number(total)).toBeGreaterThanOrEqual(1);
    await expect(gm.getByRole('textbox', { name: 'Iniciativa de Lia' })).toHaveValue(String(total));
  });

  test('o diário compartilhado chega à jogadora; as notas do Mestre, não', async ({ browser }) => {
    const gm = await newDevice(browser);
    const player = await newDevice(browser);
    await createCampaign(gm);
    await joinWithInvite(player, await inviteLink(gm), 'Ana', 'Lia');
    await startTable(gm, player, 'Ana');

    const write = async (title: string, text: string, shared: boolean) => {
      await gm.getByRole('button', { name: 'Nova entrada' }).click();
      const dialog = gm.getByRole('dialog', { name: 'Nova entrada' });
      await dialog.getByLabel('Título').fill(title);
      await dialog.getByLabel('Texto').fill(text);
      const share = dialog.getByRole('checkbox', { name: 'Compartilhar com a mesa' });
      if ((await share.getAttribute('aria-checked')) !== String(shared)) await share.click();
      await dialog.getByRole('button', { name: 'Salvar' }).click();
      await expect(dialog).toBeHidden();
    };
    await write('Sessão 1', 'A mesa chegou à mina.', true);
    await write('O vilão é o prefeito', 'Não contar ainda.', false);

    const diary = player.getByRole('list', { name: 'Entradas do diário' });
    await expect(diary).toContainText('Sessão 1');
    await expect(diary).toContainText('A mesa chegou à mina.');
    await expect(diary).not.toContainText('prefeito');
  });

  test('cutscene: o Mestre mostra uma imagem e a jogadora a vê em tela cheia', async ({
    browser,
  }) => {
    const gm = await newDevice(browser);
    const player = await newDevice(browser);
    await createCampaign(gm);
    await joinWithInvite(player, await inviteLink(gm), 'Ana', 'Lia');
    await startTable(gm, player, 'Ana');

    // Uma imagem de verdade (PNG): uma captura da própria tela. A redução (canvas → WebP)
    // e o IndexedDB são os do navegador.
    const png = await gm.screenshot();
    await gm.getByLabel('Escolher imagem').setInputFiles({
      name: 'mapa-da-mina.png',
      mimeType: 'image/png',
      buffer: png,
    });
    const dialog = gm.getByRole('dialog', { name: 'Adicionar imagem' });
    await dialog.getByLabel('Nome').fill('Mapa da mina');
    await dialog.getByLabel('Legenda (opcional)').fill('O túnel norte está marcado.');
    await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await gm.getByRole('button', { name: 'Mostrar Mapa da mina à mesa' }).click();

    const overlay = player.getByRole('dialog', { name: 'Mapa da mina' });
    await expect(overlay.getByRole('img')).toBeVisible();
    // A imagem chegou inteira e o navegador a decodificou (largura real > 0).
    await expect
      .poll(() => overlay.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(overlay).toContainText('O túnel norte está marcado.');

    await gm.getByRole('button', { name: 'Parar de mostrar' }).click();
    await expect(overlay).toBeHidden();
  });

  test('chat: a mesa conversa, e o sussurro chega só a quem foi mandado', async ({ browser }) => {
    const gm = await newDevice(browser);
    const ana = await newDevice(browser);
    const bia = await newDevice(browser);
    await createCampaign(gm);
    const link = await inviteLink(gm);
    await joinWithInvite(ana, link, 'Ana', 'Lia');
    await joinWithInvite(bia, link, 'Bia', 'Mira');
    await startTable(gm, ana, 'Ana');
    await bia.getByRole('button', { name: 'Entrar na sessão' }).click();
    await expect(
      gm.getByRole('article', { name: 'Jogador Bia' }).getByText('Online'),
    ).toBeVisible();

    const open = async (page: typeof gm) => {
      await page.getByRole('button', { name: /Abrir chat/ }).click();
      return page.getByRole('region', { name: 'Chat da sessão' });
    };
    const gmChat = await open(gm);
    const anaChat = await open(ana);
    const biaChat = await open(bia);

    await gmChat.getByLabel('Falar como').fill('Taverneiro');
    await gmChat.getByLabel('Mensagem').fill('Bem-vindos à Taverna do Javali!');
    await gmChat.getByLabel('Mensagem').press('Enter');
    await expect(anaChat).toContainText('Taverneiro (Paulo): Bem-vindos à Taverna do Javali!');
    await expect(biaChat).toContainText('Bem-vindos à Taverna do Javali!');

    await anaChat.getByRole('button', { name: 'Como Lia' }).click();
    await anaChat.getByLabel('Mensagem').fill('/me pede uma caneca');
    await anaChat.getByLabel('Mensagem').press('Enter');
    await expect(biaChat).toContainText('Lia pede uma caneca (Ana)');
    await expect(gmChat).toContainText('Lia pede uma caneca (Ana)');

    await anaChat.getByRole('button', { name: 'Como Lia' }).click();
    await anaChat.getByLabel('Para').selectOption({ label: 'Sussurro: Paulo' });
    await anaChat.getByLabel('Mensagem').fill('Desconfio do taverneiro.');
    await anaChat.getByLabel('Mensagem').press('Enter');
    await expect(gmChat).toContainText('Ana: Desconfio do taverneiro.');
    // Uma mensagem pública depois prova que o sussurro teria tido tempo de chegar à Bia.
    await gmChat.getByLabel('Falar como').fill('');
    await gmChat.getByLabel('Mensagem').fill('/r 1d1+4 Teste');
    await gmChat.getByLabel('Mensagem').press('Enter');
    await expect(biaChat).toContainText('Paulo · Teste');
    await expect(biaChat).not.toContainText('Desconfio');
  });

  test('retrato: a jogadora escolhe um retrato e o Mestre o vê no card', async ({ browser }) => {
    const gm = await newDevice(browser);
    const player = await newDevice(browser);
    await createCampaign(gm);
    await joinWithInvite(player, await inviteLink(gm), 'Ana', 'Lia');
    await startTable(gm, player, 'Ana');

    await player.getByRole('link', { name: 'Abrir ficha' }).click();
    // Uma imagem de verdade (PNG): a redução (canvas → WebP, até 384 px) é a do navegador.
    await player.getByLabel('Arquivo do retrato').setInputFiles({
      name: 'lia.png',
      mimeType: 'image/png',
      buffer: await player.screenshot(),
    });
    const own = player.getByRole('img', { name: 'Retrato de Lia' });
    await expect(own).toHaveAttribute('src', /^data:image\/webp;base64,/);

    const card = gm.getByRole('article', { name: 'Jogador Ana' });
    const portrait = card.getByRole('img', { name: 'Retrato de Lia' });
    await expect(portrait).toBeVisible();
    const size = await portrait.evaluate((img: HTMLImageElement) => [
      img.naturalWidth,
      img.naturalHeight,
    ]);
    expect(Math.max(...size)).toBeLessThanOrEqual(384);
    expect(Math.min(...size)).toBeGreaterThan(0);
  });
});
