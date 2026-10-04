import { z } from 'zod';
import {
  FiniteNumberSchema,
  IdSchema,
  LabelSchema,
  LIMITS,
  TimestampSchema,
} from '../schema/primitives';
import { TemplateRefSchema } from '../template/schema';

/** Valor de um campo simples (também usado dentro de itens de lista). */
export const PrimitiveValueSchema = z.union([
  FiniteNumberSchema,
  z.string().max(LIMITS.text),
  z.boolean(),
  z.array(IdSchema).max(LIMITS.selectOptions),
]);
export type PrimitiveValue = z.infer<typeof PrimitiveValueSchema>;

export const ResourceValueSchema = z.object({
  current: FiniteNumberSchema,
  /** Presente apenas quando o template não define fórmula para o máximo. */
  max: FiniteNumberSchema.optional(),
  /** Pontos temporários (ex.: HP temporário). */
  temp: FiniteNumberSchema.optional(),
});
export type ResourceValue = z.infer<typeof ResourceValueSchema>;

export const ListItemSchema = z.object({
  /** ID estável do item: permite mesclar edições concorrentes na mesma lista. */
  id: IdSchema,
  values: z.record(IdSchema, PrimitiveValueSchema),
});
export type ListItem = z.infer<typeof ListItemSchema>;

export const FieldValueSchema = z.union([
  PrimitiveValueSchema,
  ResourceValueSchema,
  z.array(ListItemSchema).max(LIMITS.listItems),
]);
export type FieldValue = z.infer<typeof FieldValueSchema>;

export const CharacterSheetSchema = z.object({
  id: IdSchema,
  name: LabelSchema,
  /** Dispositivo/usuário local dono da ficha (não há contas). */
  ownerId: IdSchema,
  templateRef: TemplateRefSchema,
  /** Valores indexados pelo ID estável do campo. Campos calculados nunca aparecem aqui. */
  values: z.record(IdSchema, FieldValueSchema),
  /**
   * Valores de campos que deixaram de existir (ou mudaram de tipo) após atualizar o template.
   * Guardados para não perder dados; restaurados se o campo voltar.
   */
  orphaned: z.record(IdSchema, FieldValueSchema).optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type CharacterSheet = z.infer<typeof CharacterSheetSchema>;
export type SheetValues = CharacterSheet['values'];
