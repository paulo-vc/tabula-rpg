import {
  evaluateFormula,
  type EvaluationError,
  type FormulaEnvironment,
  type FormulaRef,
} from '../formula';
import type { Result } from '../result';
import type { CompiledTemplate } from '../template/compile';
import type { FieldDef, FieldOf, ListItemFieldDef } from '../template/schema';
import type { FieldValue, ListItem, ResourceValue, SheetValues } from './schema';
import { defaultValue, listItemValue } from './values';

/** Resultado do cálculo de cada fórmula, por ID de campo. */
export interface DerivedValues {
  /** Valor de cada campo `computed`. */
  computed: Record<string, Result<number, EvaluationError>>;
  /** Máximo de cada `resource` que tem fórmula. */
  resourceMax: Record<string, Result<number, EvaluationError>>;
}

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const selectedOptions = (value: FieldValue | undefined): string[] =>
  Array.isArray(value)
    ? (value as unknown[]).filter((v): v is string => typeof v === 'string')
    : typeof value === 'string' && value !== ''
      ? [value]
      : [];

/** Valor numérico de uma seleção: soma dos números das opções marcadas (0 sem número). */
const selectNumber = (field: FieldOf<'select'>, value: FieldValue | undefined): number => {
  const selected = selectedOptions(value);
  return field.options
    .filter((option) => selected.includes(option.value))
    .reduce((total, option) => total + (option.number ?? 0), 0);
};

/** Valor numérico de um campo simples (também de itens de lista). */
function primitiveNumber(field: FieldDef | ListItemFieldDef, value: FieldValue | undefined) {
  switch (field.type) {
    case 'number':
      return asNumber(value);
    case 'boolean':
      return value === true ? 1 : 0;
    case 'select':
      return selectNumber(field, value);
    default:
      return undefined;
  }
}

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

  const listOf = (key: string): { field: FieldOf<'list'>; items: ListItem[] } | undefined => {
    const field = compiled.fieldsByKey.get(key);
    if (field?.type !== 'list') return undefined;
    const value = valueOf(field);
    return { field, items: Array.isArray(value) ? (value as ListItem[]) : [] };
  };

  const environment: FormulaEnvironment = {
    scalar: (ref: FormulaRef) => {
      const field = compiled.fieldsByKey.get(ref.key);
      if (!field) return undefined;
      switch (field.type) {
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
          return primitiveNumber(field, valueOf(field));
      }
    },
    selection: (ref: FormulaRef, item?: number) => {
      if (item === undefined) {
        const field = compiled.fieldsByKey.get(ref.key);
        return field?.type === 'select' ? selectedOptions(valueOf(field)) : undefined;
      }
      const list = listOf(ref.key);
      const itemField = list?.field.itemFields.find((f) => f.key === ref.prop);
      const entry = list?.items[item];
      if (!itemField || !entry) return undefined;
      return selectedOptions(listItemValue(itemField, entry));
    },
    listLength: (key: string) => listOf(key)?.items.length,
    itemValue: (ref: FormulaRef, item: number) => {
      const list = listOf(ref.key);
      const itemField = list?.field.itemFields.find((f) => f.key === ref.prop);
      const entry = list?.items[item];
      if (!itemField || !entry) return undefined;
      return primitiveNumber(itemField, listItemValue(itemField, entry));
    },
  };

  // A ordem topológica garante que cada fórmula é calculada depois das que ela usa.
  for (const formula of compiled.formulas) {
    const result = evaluateFormula(formula.ast, environment);
    const target = formula.target === 'value' ? derived.computed : derived.resourceMax;
    target[formula.fieldId] = result;
  }
  return derived;
}
