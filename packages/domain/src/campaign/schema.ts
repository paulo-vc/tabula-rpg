import { z } from 'zod';
import { IdSchema, LabelSchema, LIMITS, TimestampSchema } from '../schema/primitives';
import { TemplateRefSchema } from '../template/schema';

export const CampaignMemberSchema = z.object({
  userId: IdSchema,
  displayName: LabelSchema,
  /** Ficha vinculada à campanha. Ausente enquanto o jogador ainda não escolheu/criou uma. */
  sheetId: IdSchema.optional(),
});
export type CampaignMember = z.infer<typeof CampaignMemberSchema>;

export const CampaignSchema = z.object({
  id: IdSchema,
  name: LabelSchema,
  /** Usuário local do Mestre. */
  gmId: IdSchema,
  /** Template oficial da campanha: toda ficha vinculada deve ser deste sistema. */
  templateRef: TemplateRefSchema,
  members: z.array(CampaignMemberSchema).max(LIMITS.members),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Campaign = z.infer<typeof CampaignSchema>;
