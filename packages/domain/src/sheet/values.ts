import type { FieldDef, ListItemFieldDef } from '../template/schema';
import type { FieldValue, ListItem, PrimitiveValue, ResourceValue } from './schema';

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Valor inicial de um campo. `undefined` para campos calculados (nunca armazenados). */
export function defaultValue(field: FieldDef | ListItemFieldDef): FieldValue | undefined {
  switch (field.type) {
    case 'number':
      return field.default ?? 0;
    case 'text':
    case 'longtext':
    case 'dice':
      return field.default ?? '';
    case 'boolean':
      return field.default ?? false;
    case 'select':
      return field.default ?? (field.multiple ? [] : '');
    case 'resource': {
      const initial = field.default ?? 0;
      const value: ResourceValue = { current: initial };
      if (field.max === undefined) value.max = initial;
      return value;
    }
    case 'list':
      return [];
    case 'computed':
      return undefined;
  }
}

/**
 * Descreve o problema se `value` não for um valor válido para `field`, ou `undefined` se for.
 * Usado na validação de fichas e na migração entre versões de template.
 */
export function valueProblem(
  field: FieldDef | ListItemFieldDef,
  value: FieldValue,
): string | undefined {
  switch (field.type) {
    case 'number': {
      if (!isNumber(value)) return 'Deve ser um número';
      if (field.integer && !Number.isInteger(value)) return 'Deve ser um número inteiro';
      // Mínimo e máximo são orientações da interface, não invalidam a ficha:
      // regras da casa e efeitos temporários podem ultrapassá-los.
      return undefined;
    }
    case 'text':
    case 'longtext':
    case 'dice':
      return typeof value === 'string' ? undefined : 'Deve ser um texto';
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'Deve ser verdadeiro ou falso';
    case 'select': {
      const options = field.options.map((option) => option.value);
      if (field.multiple) {
        if (!isStringArray(value)) return 'Deve ser uma lista de opções';
        return value.every((v) => options.includes(v)) ? undefined : 'Opção inexistente';
      }
      if (typeof value !== 'string') return 'Deve ser uma única opção';
      return value === '' || options.includes(value) ? undefined : 'Opção inexistente';
    }
    case 'resource': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return 'Deve ser um recurso (atual/máximo)';
      }
      if (!isNumber(value.current)) return 'Valor atual inválido';
      if (field.max === undefined && !isNumber(value.max)) return 'Máximo ausente';
      return undefined;
    }
    case 'list': {
      if (!Array.isArray(value)) return 'Deve ser uma lista';
      if (field.maxItems !== undefined && value.length > field.maxItems) {
        return `Máximo de ${field.maxItems} itens`;
      }
      const items = value as ListItem[];
      const ids = new Set<string>();
      for (const item of items) {
        if (typeof item !== 'object' || item === null || !('values' in item)) {
          return 'Item inválido';
        }
        if (ids.has(item.id)) return 'Itens com ID repetido';
        ids.add(item.id);
        for (const itemField of field.itemFields) {
          const itemValue = item.values[itemField.id];
          if (itemValue === undefined) continue; // ausente = padrão
          const problem = valueProblem(itemField, itemValue);
          if (problem) return `${itemField.label}: ${problem}`;
        }
      }
      return undefined;
    }
    case 'computed':
      return 'Campos calculados não são armazenados';
  }
}

/** Lê o valor de um campo de item de lista, aplicando o padrão se ausente. */
export function listItemValue(field: ListItemFieldDef, item: ListItem): PrimitiveValue {
  return (item.values[field.id] ?? defaultValue(field)) as PrimitiveValue;
}
