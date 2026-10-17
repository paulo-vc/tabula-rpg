import { z } from 'zod';
import { IdSchema, LabelSchema } from '../schema/primitives';

/** De onde vem o bônus (só para mostrar; o cálculo é o mesmo). */
export const BONUS_KINDS = ['item', 'maldicao', 'bencao', 'outro'] as const;
export type BonusKind = (typeof BONUS_KINDS)[number];

export const BONUS_KIND_LABELS: Record<BonusKind, string> = {
  item: 'Item',
  maldicao: 'Maldição',
  bencao: 'Bênção',
  outro: 'Outro',
};

/** Quantos bônus uma ficha guarda, e quantos campos cada um altera. */
export const BONUS_LIMIT = 50;
export const BONUS_TARGET_LIMIT = 10;
const BONUS_VALUE_LIMIT = 999;

/**
 * Bônus (ou penalidade) de um item, maldição ou bênção: soma um valor a um ou mais campos da
 * ficha enquanto estiver ativo. Vale para campos de número (ex.: Força) e calculados (ex.:
 * bônus de proficiência, Atletismo); quem depende deles nas fórmulas acompanha.
 */
export const BonusSchema = z.object({
  id: IdSchema,
  name: LabelSchema,
  kind: z.enum(BONUS_KINDS),
  active: z.boolean(),
  targets: z
    .array(
      z.object({
        fieldId: IdSchema,
        value: z.number().int().min(-BONUS_VALUE_LIMIT).max(BONUS_VALUE_LIMIT),
      }),
    )
    .min(1)
    .max(BONUS_TARGET_LIMIT),
});
export type Bonus = z.infer<typeof BonusSchema>;

/** O efeito dos bônus ativos num campo: o total e de onde vem cada parte. */
export interface BonusEffect {
  total: number;
  sources: { name: string; kind: BonusKind; value: number }[];
}

/** Efeito dos bônus ativos, por ID de campo (só os campos com algum bônus). */
export function bonusEffects(bonuses: readonly Bonus[] | undefined): Map<string, BonusEffect> {
  const effects = new Map<string, BonusEffect>();
  for (const bonus of bonuses ?? []) {
    if (!bonus.active) continue;
    for (const target of bonus.targets) {
      if (target.value === 0) continue;
      const effect = effects.get(target.fieldId) ?? { total: 0, sources: [] };
      effect.total += target.value;
      effect.sources.push({ name: bonus.name, kind: bonus.kind, value: target.value });
      effects.set(target.fieldId, effect);
    }
  }
  return effects;
}
