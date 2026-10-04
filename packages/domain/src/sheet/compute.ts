import { evaluateFormula, type EvaluationError, type FormulaRef } from '../formula';
import type { Result } from '../result';
import type { CompiledTemplate } from '../template/compile';
import type { FieldDef } from '../template/schema';
import type { ResourceValue, SheetValues } from './schema';
import { defaultValue } from './values';

/** Resultado do cálculo de cada fórmula, por ID de campo. */
export interface DerivedValues {
  /** Valor de cada campo `computed`. */
  computed: Record<string, Result<number, EvaluationError>>;
  /** Máximo de cada `resource` que tem fórmula. */
  resourceMax: Record<string, Result<number, EvaluationError>>;
}

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Calcula todos os valores derivados de uma ficha. Função pura: os mesmos valores sempre
 * produzem o mesmo resultado. Um erro numa fórmula não impede o cálculo das demais; as que
 * dependem dela também reportam erro.
 */
export function computeDerived(compiled: CompiledTemplate, values: SheetValues): DerivedValues {
  const derived: DerivedValues = { computed: {}, resourceMax: {} };

  const valueOf = (field: FieldDef) => values[field.id] ?? defaultValue(field);
  const success = (result: Result<number, EvaluationError> | undefined) =>
    result?.ok ? result.value : undefined;

  const resolve = (ref: FormulaRef): number | undefined => {
    const field = compiled.fieldsByKey.get(ref.key);
    if (!field) return undefined;
    switch (field.type) {
      case 'number':
        return asNumber(valueOf(field));
      case 'boolean':
        return valueOf(field) === true ? 1 : 0;
      case 'computed':
        return success(derived.computed[field.id]);
      case 'resource': {
        const resource = valueOf(field) as ResourceValue | undefined;
        if (ref.prop === 'max') {
          return field.max === undefined
            ? asNumber(resource?.max)
            : success(derived.resourceMax[field.id]);
        }
        if (ref.prop === 'temp') return asNumber(resource?.temp) ?? 0;
        return asNumber(resource?.current);
      }
      default:
        return undefined;
    }
  };

  // A ordem topológica garante que cada fórmula é calculada depois das que ela usa.
  for (const formula of compiled.formulas) {
    const result = evaluateFormula(formula.ast, resolve);
    const target = formula.target === 'value' ? derived.computed : derived.resourceMax;
    target[formula.fieldId] = result;
  }
  return derived;
}
