import { checkExpression, parseDice } from '../dice/dice';
import type { DerivedValues } from '../sheet/compute';
import type { SheetValues } from '../sheet/schema';
import type { CompiledTemplate } from '../template/compile';

/**
 * Rolagem de iniciativa de uma ficha: o dado dos testes do sistema mais o modificador do
 * campo de iniciativa (ex.: "1d20+2"). `null` se o sistema não define iniciativa (ex.:
 * Daggerheart) ou se o modificador não pode ser calculado agora.
 */
export function initiativeExpression(
  compiled: CompiledTemplate,
  values: SheetValues,
  derived: DerivedValues,
): string | null {
  const fieldId = compiled.template.initiative;
  if (fieldId === undefined) return null;
  const field = compiled.fieldsById.get(fieldId);
  let modifier: number | null = null;
  if (field?.type === 'computed') {
    const result = derived.computed[fieldId];
    modifier = result?.ok ? result.value : null;
  } else if (field?.type === 'number') {
    const value = values[fieldId];
    modifier = typeof value === 'number' ? value : (field.default ?? 0);
  }
  if (modifier === null || !Number.isFinite(modifier)) return null;
  const expression = checkExpression(compiled.template.checkDice ?? '1d20', Math.trunc(modifier));
  return parseDice(expression).ok ? expression : null;
}
