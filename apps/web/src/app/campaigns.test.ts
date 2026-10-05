import 'fake-indexeddb/auto';
import { TabulaDatabase } from '@tabula/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeInvite, encodeInvite, inviteUrl, randomSecret } from './invite-link';
import { createServices, type Services } from './services';

const BASE = 'https://exemplo.github.io/tabula/';

/** Dois dispositivos independentes: cada um com seu banco e seu ID. */
let gmDb: TabulaDatabase;
let playerDb: TabulaDatabase;
let gm: Services;
let player: Services;

beforeEach(() => {
  gmDb = new TabulaDatabase(`mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`jogador-${crypto.randomUUID()}`);
  gm = createServices(gmDb);
  player = createServices(playerDb);
});

afterEach(async () => {
  await gmDb.delete();
  await playerDb.delete();
});

async function newCampaign() {
  return gm.campaigns.create({ name: 'A Mina Perdida', templateId: 'dnd5e-srd', gmName: 'Paulo' });
}

async function inviteFromGm() {
  const campaign = await newCampaign();
  const decoded = decodeInvite(gm.campaigns.inviteLink(campaign, BASE));
  if (!decoded.ok) throw new Error(decoded.error.message);
  return { campaign, invite: decoded.value };
}

describe('link de convite', () => {
  it('gera segredos de 128 bits diferentes a cada chamada', () => {
    const secrets = new Set(Array.from({ length: 50 }, randomSecret));
    expect(secrets.size).toBe(50);
    for (const secret of secrets) expect(secret).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('coloca o convite inteiro depois do # (nunca enviado a servidores)', async () => {
    const campaign = await newCampaign();
    const link = gm.campaigns.inviteLink(campaign, BASE);
    const url = new URL(link);
    expect(`${url.origin}${url.pathname}`).toBe(BASE);
    expect(url.search).toBe('');
    expect(url.hash.startsWith('#/convite/')).toBe(true);
    expect(link).not.toContain(campaign.secret); // codificado, não em texto puro
  });

  it('lê o link completo, só o código ou um link de outra base', async () => {
    const { campaign, invite } = await inviteFromGm();
    const code = encodeInvite(invite);
    for (const text of [
      inviteUrl(invite, BASE),
      code,
      `  ${code}  `,
      inviteUrl(invite, 'http://localhost:5173/'),
    ]) {
      expect(decodeInvite(text)).toMatchObject({ ok: true, value: { campaignId: campaign.id } });
    }
  });

  it('acentos sobrevivem à codificação', async () => {
    const campaign = await gm.campaigns.create({
      name: 'Ação & Reação',
      templateId: 'dnd5e-srd',
      gmName: 'Conceição',
    });
    const decoded = decodeInvite(gm.campaigns.inviteLink(campaign, BASE));
    expect(decoded).toMatchObject({
      ok: true,
      value: { name: 'Ação & Reação', gmName: 'Conceição' },
    });
  });

  it.each([
    ['vazio', ''],
    ['texto qualquer', 'olá mundo'],
    ['base64 que não é JSON', 'aGVsbG8'],
    ['JSON sem os campos do convite', btoa('{"a":1}').replace(/=+$/, '')],
    ['enorme', 'A'.repeat(5000)],
  ])('recusa convite %s', (_, text) => {
    expect(decodeInvite(text)).toMatchObject({ ok: false, error: { code: 'convite-invalido' } });
  });

  it('pede atualização para convites de versão futura', async () => {
    const { invite } = await inviteFromGm();
    const future = encodeInvite({ ...invite, v: 2 } as never);
    expect(decodeInvite(future)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('versão mais nova') },
    });
  });
});

describe('CampaignService', () => {
  it('o Mestre cria a campanha e lembra o próprio nome', async () => {
    const campaign = await newCampaign();
    expect(campaign).toMatchObject({
      name: 'A Mina Perdida',
      gmName: 'Paulo',
      templateName: 'D&D 5ª Edição (SRD 5.1)',
    });
    expect(await gm.device.getDisplayName()).toBe('Paulo');
    expect(await gm.campaignRepository.get(campaign.id)).toBeDefined();
  });

  it('a jogadora entra pelo convite em outro dispositivo', async () => {
    const { campaign, invite } = await inviteFromGm();
    const joined = await player.campaigns.join(invite, 'Ana');
    expect(joined.ok).toBe(true);
    const stored = await player.campaignRepository.get(campaign.id);
    expect(stored).toMatchObject({ gmName: 'Paulo', secret: campaign.secret });
    expect(stored?.members).toEqual([
      { userId: await player.device.getDeviceId(), displayName: 'Ana' },
    ]);
  });

  it('entrar de novo não duplica a campanha', async () => {
    const { invite } = await inviteFromGm();
    await player.campaigns.join(invite, 'Ana');
    await player.campaigns.join(invite, 'Outro nome');
    const list = await player.campaignRepository.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.members[0]?.displayName).toBe('Ana');
  });

  it('o Mestre que abre o próprio convite cai na campanha dele, sem virar jogador', async () => {
    const { campaign, invite } = await inviteFromGm();
    const result = await gm.campaigns.join(invite, 'Paulo');
    expect(result).toMatchObject({ ok: true, value: { id: campaign.id, members: [] } });
  });

  it('a jogadora cria uma ficha já vinculada à campanha', async () => {
    const { campaign, invite } = await inviteFromGm();
    await player.campaigns.join(invite, 'Ana');
    const result = await player.campaigns.createLinkedSheet(campaign.id, 'Lia');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.templateRef.id).toBe('dnd5e-srd');
    const stored = await player.campaignRepository.get(campaign.id);
    expect(stored?.members[0]?.sheetId).toBe(result.value.id);
  });

  it('vincula uma ficha existente e lista só as compatíveis', async () => {
    const { campaign, invite } = await inviteFromGm();
    const joined = await player.campaigns.join(invite, 'Ana');
    if (!joined.ok) throw new Error('falhou');
    const existing = await player.sheets.create({ name: 'Thorin', templateId: 'dnd5e-srd' });

    expect((await player.campaigns.compatibleSheets(joined.value)).map((s) => s.id)).toEqual([
      existing.id,
    ]);
    const linked = await player.campaigns.linkSheet(campaign.id, existing.id);
    expect(linked.ok && linked.value.members[0]?.sheetId).toBe(existing.id);
  });

  it('não cria ficha se o sistema da campanha não está instalado', async () => {
    const homebrew = {
      id: 'caixa-preta',
      version: '1.0.0',
      name: 'Caixa Preta',
      source: 'local' as const,
      fields: [{ id: 'vigor', key: 'vigor', label: 'Vigor', type: 'number' as const }],
      layouts: { full: [] },
    };
    await gm.files.import(gm.files.exportTemplate(homebrew).content);
    const campaign = await gm.campaigns.create({
      name: 'Mesa',
      templateId: 'caixa-preta',
      gmName: 'Paulo',
    });
    const decoded = decodeInvite(gm.campaigns.inviteLink(campaign, BASE));
    if (!decoded.ok) throw new Error('falhou');
    await player.campaigns.join(decoded.value, 'Ana');

    expect(await player.campaigns.createLinkedSheet(campaign.id, 'Lia')).toMatchObject({
      ok: false,
      error: { code: 'sistema-ausente' },
    });
  });

  it('sair da campanha não apaga as fichas', async () => {
    const { campaign, invite } = await inviteFromGm();
    await player.campaigns.join(invite, 'Ana');
    const created = await player.campaigns.createLinkedSheet(campaign.id, 'Lia');
    await player.campaigns.delete(campaign.id);
    expect(await player.campaignRepository.get(campaign.id)).toBeUndefined();
    expect(created.ok && (await player.sheetRepository.get(created.value.id))).toBeTruthy();
  });
});
