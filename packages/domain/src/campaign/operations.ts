import { err, ok, type Issue, type Result } from '../result';
import type { CharacterSheet } from '../sheet/schema';
import type { SystemTemplate } from '../template/schema';
import { INVITE_VERSION, type Campaign, type CampaignInvite } from './schema';

export type CampaignRole = 'mestre' | 'jogador';

export const roleOf = (campaign: Campaign, userId: string): CampaignRole =>
  campaign.gmId === userId ? 'mestre' : 'jogador';

export interface NewCampaignInput {
  id: string;
  name: string;
  template: SystemTemplate;
  gm: { userId: string; displayName: string };
  /** Gerado pelo chamador com aleatoriedade criptográfica (ver `CampaignSecretSchema`). */
  secret: string;
  now: number;
}

export function createCampaign(input: NewCampaignInput): Campaign {
  const { template } = input;
  return {
    id: input.id,
    name: input.name.trim(),
    gmId: input.gm.userId,
    gmName: input.gm.displayName.trim(),
    templateRef: { id: template.id, version: template.version, source: template.source },
    templateName: template.name,
    secret: input.secret,
    members: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function inviteFor(campaign: Campaign): CampaignInvite {
  return {
    v: INVITE_VERSION,
    campaignId: campaign.id,
    name: campaign.name,
    gmId: campaign.gmId,
    gmName: campaign.gmName,
    templateRef: campaign.templateRef,
    templateName: campaign.templateName,
    secret: campaign.secret,
  };
}

/** Cópia da campanha no dispositivo do jogador, criada a partir do convite. */
export function joinCampaign(
  invite: CampaignInvite,
  player: { userId: string; displayName: string },
  now: number,
): Result<Campaign, Issue> {
  if (invite.gmId === player.userId) {
    return err({
      code: 'convite-proprio',
      path: [],
      message: 'Você é o Mestre desta campanha: não é preciso entrar pelo convite.',
    });
  }
  return ok({
    id: invite.campaignId,
    name: invite.name,
    gmId: invite.gmId,
    gmName: invite.gmName,
    templateRef: invite.templateRef,
    templateName: invite.templateName,
    secret: invite.secret,
    members: [{ userId: player.userId, displayName: player.displayName.trim() }],
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Vincula a ficha de um participante à campanha. Só aceita fichas do sistema da campanha:
 * diferenças de versão do mesmo sistema são resolvidas pela migração ao abrir a ficha.
 */
export function linkSheet(
  campaign: Campaign,
  member: { userId: string; displayName: string },
  sheet: CharacterSheet,
  now: number,
): Result<Campaign, Issue> {
  if (sheet.templateRef.id !== campaign.templateRef.id) {
    return err({
      code: 'sistema-diferente',
      path: ['templateRef'],
      message: `Esta campanha usa "${campaign.templateName}". Escolha ou crie uma ficha desse sistema.`,
    });
  }
  const others = campaign.members.filter((m) => m.userId !== member.userId);
  return ok({
    ...campaign,
    members: [...others, { ...member, sheetId: sheet.id }],
    updatedAt: now,
  });
}

/** Ficha vinculada por um participante, se houver. */
export const linkedSheetId = (campaign: Campaign, userId: string): string | undefined =>
  campaign.members.find((m) => m.userId === userId)?.sheetId;
