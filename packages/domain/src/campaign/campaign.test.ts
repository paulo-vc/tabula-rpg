import { describe, expect, it } from 'vitest';
import { createSheet } from '../sheet/operations';
import { clone, compiledMiniTemplate, miniTemplate } from '../testing/fixtures';
import {
  createCampaign,
  inviteFor,
  joinCampaign,
  linkedSheetId,
  linkSheet,
  roleOf,
} from './operations';
import { CampaignInviteSchema, CampaignSchema } from './schema';

const SECRET = 'AAAAAAAAAAAAAAAAAAAAAA'; // 22 caracteres base64url
const gm = { userId: 'mestre-1', displayName: ' Paulo ' };
const player = { userId: 'jogadora-1', displayName: 'Ana' };

const newCampaign = () =>
  createCampaign({
    id: 'c1',
    name: ' A Mina Perdida ',
    template: miniTemplate(),
    gm,
    secret: SECRET,
    now: 10,
  });

const sheetOf = (templateId = 'mini-5e') => {
  const template = clone(miniTemplate());
  template.id = templateId;
  return createSheet(compiledMiniTemplate(template), {
    id: 's1',
    name: 'Thorin',
    ownerId: player.userId,
    now: 0,
  });
};

describe('createCampaign', () => {
  it('cria a campanha com o Mestre e o sistema escolhido', () => {
    const campaign = newCampaign();
    expect(campaign).toMatchObject({
      name: 'A Mina Perdida',
      gmId: 'mestre-1',
      gmName: 'Paulo',
      templateRef: { id: 'mini-5e', version: '1.0.0', source: 'local' },
      templateName: 'Mini 5e',
      members: [],
    });
    expect(CampaignSchema.safeParse(campaign).success).toBe(true);
  });

  it('define o papel de cada usuário', () => {
    expect(roleOf(newCampaign(), 'mestre-1')).toBe('mestre');
    expect(roleOf(newCampaign(), 'jogadora-1')).toBe('jogador');
  });
});

describe('convite', () => {
  it('leva só o necessário para entrar na sala (sem membros nem datas)', () => {
    const invite = inviteFor(newCampaign());
    expect(Object.keys(invite).sort()).toEqual(
      ['campaignId', 'gmId', 'gmName', 'name', 'secret', 'templateName', 'templateRef', 'v'].sort(),
    );
    expect(CampaignInviteSchema.safeParse(invite).success).toBe(true);
  });

  it('recusa segredos com tamanho ou caracteres inválidos', () => {
    const invite = inviteFor(newCampaign());
    expect(CampaignInviteSchema.safeParse({ ...invite, secret: 'curto' }).success).toBe(false);
    expect(
      CampaignInviteSchema.safeParse({ ...invite, secret: 'A'.repeat(21) + '/' }).success,
    ).toBe(false);
  });

  it('recusa convites de uma versão futura do formato', () => {
    expect(CampaignInviteSchema.safeParse({ ...inviteFor(newCampaign()), v: 2 }).success).toBe(
      false,
    );
  });
});

describe('joinCampaign', () => {
  it('cria a cópia do jogador com ele como membro', () => {
    const result = joinCampaign(inviteFor(newCampaign()), player, 20);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      id: 'c1',
      gmId: 'mestre-1',
      secret: SECRET,
      members: [{ userId: 'jogadora-1', displayName: 'Ana' }],
      createdAt: 20,
    });
    expect(roleOf(result.value, player.userId)).toBe('jogador');
  });

  it('o Mestre não entra pelo próprio convite', () => {
    expect(joinCampaign(inviteFor(newCampaign()), gm, 20)).toMatchObject({
      ok: false,
      error: { code: 'convite-proprio' },
    });
  });
});

describe('linkSheet', () => {
  const joined = () => {
    const result = joinCampaign(inviteFor(newCampaign()), player, 20);
    if (!result.ok) throw new Error('falhou');
    return result.value;
  };

  it('vincula uma ficha do sistema da campanha', () => {
    const result = linkSheet(joined(), player, sheetOf(), 30);
    expect(result.ok && linkedSheetId(result.value, player.userId)).toBe('s1');
    expect(result.ok && result.value.updatedAt).toBe(30);
  });

  it('troca a ficha vinculada sem duplicar o membro', () => {
    const first = linkSheet(joined(), player, sheetOf(), 30);
    if (!first.ok) throw new Error('falhou');
    const other = { ...sheetOf(), id: 's2' };
    const second = linkSheet(first.value, player, other, 40);
    expect(second.ok && second.value.members).toEqual([
      { userId: 'jogadora-1', displayName: 'Ana', sheetId: 's2' },
    ]);
  });

  it('recusa ficha de outro sistema', () => {
    expect(linkSheet(joined(), player, sheetOf('coc-7e'), 30)).toMatchObject({
      ok: false,
      error: { code: 'sistema-diferente' },
    });
  });

  it('aceita versão diferente do mesmo sistema (a migração resolve ao abrir)', () => {
    const sheet = { ...sheetOf(), templateRef: { ...sheetOf().templateRef, version: '0.9.0' } };
    expect(linkSheet(joined(), player, sheet, 30).ok).toBe(true);
  });
});
