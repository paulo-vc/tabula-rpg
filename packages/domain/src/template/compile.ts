import { collectRefs, parseFormula, type FormulaNode } from '../formula';
import { parseDice } from '../dice/dice';
import { topologicalSort } from '../graph/topological-sort';
import { checkFormula } from './check-formula';
import { err, ok, type Issue, type Result } from '../result';
import { LIMITS } from '../schema/primitives';
import {
  type FieldDef,
  type LayoutNode,
  type ListItemFieldDef,
  type SystemTemplate,
} from './schema';

/** Uma fórmula do template já analisada, pronta para ser avaliada. */
export interface CompiledFormula {
  fieldId: string;
  /** `value` para campos `computed`; `max` para o máximo de um `resource`. */
  target: 'value' | 'max';
  ast: FormulaNode;
}

/**
 * Template validado e pré-processado. Compilar uma vez, avaliar muitas vezes:
 * as fórmulas já estão analisadas e na ordem em que devem ser calculadas.
 */
export interface CompiledTemplate {
  template: SystemTemplate;
  fieldsById: ReadonlyMap<string, FieldDef>;
  fieldsByKey: ReadonlyMap<string, FieldDef>;
  /** Fórmulas em ordem topológica: cada uma vem depois das que ela referencia. */
  formulas: readonly CompiledFormula[];
}

const issue = (code: string, path: Issue['path'], message: string): Issue => ({
  code,
  path,
  message,
});

/** Nó do grafo de dependências: `key` (campo calculado) ou `key.max` (máximo de recurso). */
const nodeName = (key: string, target: 'value' | 'max') => (target === 'max' ? `${key}.max` : key);

function validateFieldDefaults(
  field: FieldDef | ListItemFieldDef,
  path: Issue['path'],
  issues: Issue[],
) {
  if (field.type === 'number') {
    const { min, max, integer } = field;
    if (min !== undefined && max !== undefined && min > max) {
      issues.push(issue('intervalo-invalido', [...path, 'min'], 'O mínimo é maior que o máximo'));
    }
    const value = field.default;
    if (value === undefined) return;
    if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
      issues.push(
        issue('padrao-fora-do-intervalo', [...path, 'default'], 'Valor padrão fora do intervalo'),
      );
    }
    if (integer && !Number.isInteger(value)) {
      issues.push(
        issue('padrao-nao-inteiro', [...path, 'default'], 'Valor padrão deve ser inteiro'),
      );
    }
  }
  if (field.type === 'select') {
    const values = field.options.map((option) => option.value);
    const duplicated = values.find((value, index) => values.indexOf(value) !== index);
    if (duplicated !== undefined) {
      issues.push(
        issue('opcao-duplicada', [...path, 'options'], `Opção repetida: "${duplicated}"`),
      );
    }
    const value = field.default;
    if (value === undefined) return;
    const defaults = typeof value === 'string' ? [value] : value;
    if (Array.isArray(value) !== Boolean(field.multiple)) {
      const expected = field.multiple ? 'uma lista de opções' : 'uma única opção';
      issues.push(issue('padrao-invalido', [...path, 'default'], `O padrão deve ser ${expected}`));
    } else if (defaults.some((option) => !values.includes(option))) {
      issues.push(
        issue('padrao-invalido', [...path, 'default'], 'Padrão não está entre as opções'),
      );
    }
  }
}

function checkUnique(
  fields: readonly (FieldDef | ListItemFieldDef)[],
  path: Issue['path'],
  issues: Issue[],
) {
  const ids = new Set<string>();
  const keys = new Set<string>();
  fields.forEach((field, index) => {
    if (ids.has(field.id)) {
      issues.push(issue('id-duplicado', [...path, index, 'id'], `ID repetido: "${field.id}"`));
    }
    if (keys.has(field.key)) {
      issues.push(
        issue('key-duplicada', [...path, index, 'key'], `Apelido repetido: "@${field.key}"`),
      );
    }
    ids.add(field.id);
    keys.add(field.key);
  });
}

function validateLayout(
  nodes: readonly LayoutNode[],
  path: Issue['path'],
  fieldIds: ReadonlySet<string>,
  issues: Issue[],
) {
  const seen = new Set<string>();
  const visit = (list: readonly LayoutNode[], listPath: Issue['path'], depth: number) => {
    if (depth > LIMITS.layoutDepth) {
      issues.push(issue('layout-aninhado-demais', listPath, 'Seções aninhadas demais'));
      return;
    }
    list.forEach((node, index) => {
      const nodePath = [...listPath, index];
      if (node.kind === 'section') {
        visit(node.children, [...nodePath, 'children'], depth + 1);
        return;
      }
      const placed: [string, 'fieldId' | 'secondary'][] = [[node.fieldId, 'fieldId']];
      if (node.secondary !== undefined) placed.push([node.secondary, 'secondary']);
      if (node.secondary === node.fieldId) {
        issues.push(
          issue(
            'campo-repetido',
            [...nodePath, 'secondary'],
            'O campo não pode acompanhar a si mesmo',
          ),
        );
      }
      for (const [fieldId, property] of placed) {
        if (!fieldIds.has(fieldId)) {
          issues.push(
            issue('campo-inexistente', [...nodePath, property], `Campo inexistente: "${fieldId}"`),
          );
        } else if (seen.has(fieldId) && !(property === 'secondary' && fieldId === node.fieldId)) {
          issues.push(
            issue('campo-repetido', [...nodePath, property], 'O campo aparece mais de uma vez'),
          );
        }
        seen.add(fieldId);
      }
    });
  };
  visit(nodes, path, 1);
}

/**
 * Valida as regras que o schema sozinho não expressa (unicidade, referências, ciclos, layout)
 * e pré-processa as fórmulas. Assume um template que já passou por `SystemTemplateSchema`.
 */
export function compileTemplate(template: SystemTemplate): Result<CompiledTemplate, Issue[]> {
  const issues: Issue[] = [];
  const { fields } = template;

  checkUnique(fields, ['fields'], issues);
  fields.forEach((field, index) => {
    validateFieldDefaults(field, ['fields', index], issues);
    if (field.type === 'list') {
      checkUnique(field.itemFields, ['fields', index, 'itemFields'], issues);
      field.itemFields.forEach((item, itemIndex) =>
        validateFieldDefaults(item, ['fields', index, 'itemFields', itemIndex], issues),
      );
    }
  });

  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));

  // Fórmulas: análise sintática e referências.
  const formulas: CompiledFormula[] = [];
  const dependencies = new Map<string, string[]>();
  const byNode = new Map<string, CompiledFormula>();

  fields.forEach((field, index) => {
    const source =
      field.type === 'computed'
        ? { text: field.formula, target: 'value' as const, path: ['fields', index, 'formula'] }
        : field.type === 'resource' && field.max !== undefined
          ? { text: field.max, target: 'max' as const, path: ['fields', index, 'max'] }
          : undefined;
    if (!source) return;

    const parsed = parseFormula(source.text);
    if (!parsed.ok) {
      issues.push(
        issue(
          'formula-invalida',
          source.path,
          `${parsed.error.message} (caractere ${parsed.error.position + 1})`,
        ),
      );
      return;
    }
    const problems = checkFormula(parsed.value, fieldsByKey);
    for (const problem of problems) issues.push(issue(problem.code, source.path, problem.message));
    if (problems.length > 0) return;
    const refs = collectRefs(parsed.value);

    // Um campo que o jogador vê não pode depender de um secreto: o valor vazaria pelo
    // cálculo (e, no aparelho do jogador, que não tem o segredo, o resultado seria outro).
    if (field.visibility !== 'gm') {
      const secret = refs.find((ref) => fieldsByKey.get(ref.key)?.visibility === 'gm');
      if (secret) {
        issues.push(
          issue(
            'referencia-secreta',
            source.path,
            `@${secret.key} é visível só para o Mestre e não pode ser usado num campo que o jogador vê`,
          ),
        );
        return;
      }
    }

    const compiled: CompiledFormula = {
      fieldId: field.id,
      target: source.target,
      ast: parsed.value,
    };
    const node = nodeName(field.key, source.target);
    byNode.set(node, compiled);
    // Só `@campo_calculado` e `@recurso.max` (com fórmula) são nós; o resto é entrada.
    dependencies.set(
      node,
      refs.map((ref) =>
        nodeName(
          ref.key,
          ref.prop === 'max' && fieldsByKey.get(ref.key)?.type === 'resource' ? 'max' : 'value',
        ),
      ),
    );
  });

  const order = topologicalSort(dependencies);
  if (order.ok) {
    for (const node of order.value) formulas.push(byNode.get(node) as CompiledFormula);
  } else {
    const cycle = order.error.map((node) => `@${node}`).join(' → ');
    issues.push(issue('dependencia-circular', ['fields'], `Dependência circular: ${cycle}`));
  }

  if (template.checkDice !== undefined) {
    const dice = parseDice(template.checkDice);
    if (!dice.ok) issues.push(issue('dado-de-teste-invalido', ['checkDice'], dice.error.message));
  }

  // Layouts.
  const fieldIds = new Set(fieldsById.keys());
  validateLayout(template.layouts.full, ['layouts', 'full'], fieldIds, issues);
  if (template.layouts.compact) {
    validateLayout(template.layouts.compact, ['layouts', 'compact'], fieldIds, issues);
  }
  template.layouts.gmSummary?.forEach((fieldId, index) => {
    if (!fieldIds.has(fieldId)) {
      issues.push(
        issue(
          'campo-inexistente',
          ['layouts', 'gmSummary', index],
          `Campo inexistente: "${fieldId}"`,
        ),
      );
    }
  });

  if (issues.length > 0) return err(issues);
  return ok({ template, fieldsById, fieldsByKey, formulas });
}
