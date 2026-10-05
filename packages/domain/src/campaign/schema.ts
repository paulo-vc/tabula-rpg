import { z } from 'zod';
import { IdSchema, LabelSchema, LIMITS, TimestampSchema } from '../schema/primitives';
import { TemplateRefSchema } from '../template/schema';

/**
 * Segredo da sala: 128 bits aleatórios em base64url (22 caracteres). Cifra a sessão e só
 * viaja no fragmento (`#`) do link de convite, que os navegadores nunca enviam a servidores.
 */
export const CampaignSecretSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22}$/, 'Segredo da campanha inválido');

export const CampaignMemberSchema = z.object({
  userId: IdSchema,
  displayName: LabelSchema,
  /** Ficha vinculada à campanha. Ausente enquanto o jogador ainda não escolheu/criou uma. */
  sheetId: IdSchema.optional(),
});
export type CampaignMember = z.infer<typeof CampaignMemberSchema>;

/**
 * Campanha (mesa). Cada dispositivo guarda a sua cópia: o Mestre a cria; o jogador a recebe
 * pelo convite. O papel de cada um é derivado de `gmId` (ver `roleOf`).
 */
export const CampaignSchema = z.object({
  id: IdSchema,
  name: LabelSchema,
  /** Usuário local do Mestre. */
  gmId: IdSchema,
  gmName: LabelSchema,
  /** Template oficial da campanha: toda ficha vinculada deve ser deste sistema. */
  templateRef: TemplateRefSchema,
  /** Nome do sistema, para exibir mesmo antes de ele estar instalado no dispositivo. */
  templateName: LabelSchema,
  secret: CampaignSecretSchema,
  members: z.array(CampaignMemberSchema).max(LIMITS.members),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Campaign = z.infer<typeof CampaignSchema>;

/** Versão do formato do convite. Incrementada só em mudanças incompatíveis. */
export const INVITE_VERSION = 1;

/** Dados do convite, codificados no link. Contém só o necessário para entrar na sala. */
export const CampaignInviteSchema = z.object({
  v: z.literal(INVITE_VERSION),
  campaignId: IdSchema,
  name: LabelSchema,
  gmId: IdSchema,
  gmName: LabelSchema,
  templateRef: TemplateRefSchema,
  templateName: LabelSchema,
  secret: CampaignSecretSchema,
});
export type CampaignInvite = z.infer<typeof CampaignInviteSchema>;
