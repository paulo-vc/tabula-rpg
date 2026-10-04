import type { Issue } from '../result';
import type { CompiledTemplate } from '../template/compile';
import type { CharacterSheet, SheetValues } from './schema';
import { computeDerived } from './compute';
import { defaultValue, valueProblem } from './values';

export interface NewSheetInput {
  id: string;
  name: string;
  ownerId: string;
  /** Instante de criação (ms). Injetado para manter o domínio determinístico e testável. */
  now: number;
}

/** Cria uma ficha nova com os valores padrão do template. */
export function createSheet(compiled: CompiledTemplate, input: NewSheetInput): CharacterSheet {
  const { template } = compiled;
  const values: SheetValues = {};
  for (const field of template.fields) {
    const value = defaultValue(field);
    if (value !== undefined) values[field.id] = value;
  }

  // Recursos com máximo calculado começam cheios (ex.: HP = HP máximo), salvo padrão explícito.
  const derived = computeDerived(compiled, values);
  for (const field of template.fields) {
    if (field.type !== 'resource' || field.max === undefined || field.default !== undefined) {
      continue;
    }
    const max = derived.resourceMax[field.id];
    if (max?.ok) values[field.id] = { current: max.value };
  }

  return {
    id: input.id,
    name: input.name,
    ownerId: input.ownerId,
    templateRef: { id: template.id, version: template.version, source: template.source },
    values,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Verifica se os valores da ficha são coerentes com o template: tipos corretos,
 * opções existentes e nenhum valor para campos desconhecidos ou calculados.
 */
export function validateSheetValues(compiled: CompiledTemplate, sheet: CharacterSheet): Issue[] {
  const issues: Issue[] = [];
  if (sheet.templateRef.id !== compiled.template.id) {
    issues.push({
      code: 'template-diferente',
      path: ['templateRef', 'id'],
      message: 'A ficha pertence a outro sistema',
    });
  }
  for (const [fieldId, value] of Object.entries(sheet.values)) {
    const field = compiled.fieldsById.get(fieldId);
    const problem = field ? valueProblem(field, value) : 'Campo não existe no template';
    if (problem) {
      issues.push({
        code: field ? 'valor-invalido' : 'campo-desconhecido',
        path: ['values', fieldId],
        message: field ? `${field.label}: ${problem}` : problem,
      });
    }
  }
  return issues;
}
