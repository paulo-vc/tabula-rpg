import { RESOURCE_PROPERTIES, type FormulaNode, type FormulaRef } from '../formula';
import {
  NUMERIC_FIELD_TYPES,
  NUMERIC_ITEM_FIELD_TYPES,
  type FieldDef,
  type ListItemFieldDef,
} from './schema';

export interface FormulaProblem {
  code: string;
  message: string;
}

const NUMERIC_TYPES: ReadonlySet<string> = new Set(NUMERIC_FIELD_TYPES);
const NUMERIC_ITEM_TYPES: ReadonlySet<string> = new Set(NUMERIC_ITEM_FIELD_TYPES);

const nameOf = (ref: FormulaRef) => (ref.prop ? `@${ref.key}.${ref.prop}` : `@${ref.key}`);

/**
 * Verifica se uma fórmula faz sentido para os campos do template:
 * - referências existem e são numéricas (texto não entra em conta);
 * - propriedades existem (`@hp.max` em recurso, `@lista.campo` em lista);
 * - campos de lista só aparecem dentro de `sum()`/`count()`, todos da mesma lista;
 * - `is()` recebe uma seleção e uma opção que existe nela.
 */
export function checkFormula(
  ast: FormulaNode,
  fieldsByKey: ReadonlyMap<string, FieldDef>,
): FormulaProblem[] {
  const problems: FormulaProblem[] = [];
  const report = (code: string, message: string): void => {
    problems.push({ code, message });
  };

  /** Lista em uso dentro da agregação atual (`null` fora de sum/count). */
  type Scope = { list: string | null } | null;

  const itemField = (list: FieldDef, key: string): ListItemFieldDef | undefined =>
    list.type === 'list' ? list.itemFields.find((f) => f.key === key) : undefined;

  const visitRef = (ref: FormulaRef, scope: Scope) => {
    const field = fieldsByKey.get(ref.key);
    if (!field) return report('referencia-desconhecida', `Campo inexistente: ${nameOf(ref)}`);

    if (field.type === 'list') {
      if (!scope) {
        return report(
          'lista-fora-de-agregacao',
          `${nameOf(ref)} é uma lista: use dentro de sum() ou count(), ex.: sum(@${ref.key}.campo)`,
        );
      }
      if (scope.list !== null && scope.list !== ref.key) {
        return report(
          'listas-diferentes',
          `Não é possível misturar as listas @${scope.list} e @${ref.key} na mesma agregação`,
        );
      }
      scope.list = ref.key;
      if (ref.prop === undefined) return; // conta os itens
      const item = itemField(field, ref.prop);
      if (!item) {
        return report('propriedade-invalida', `A lista @${ref.key} não tem o campo "${ref.prop}"`);
      }
      if (!NUMERIC_ITEM_TYPES.has(item.type)) {
        return report(
          'referencia-nao-numerica',
          `${nameOf(ref)} não é numérico e não pode ser usado em fórmulas`,
        );
      }
      return;
    }

    if (!NUMERIC_TYPES.has(field.type)) {
      return report(
        'referencia-nao-numerica',
        `${nameOf(ref)} não é numérico e não pode ser usado em fórmulas`,
      );
    }
    if (ref.prop === undefined) return;
    if (field.type !== 'resource') {
      return report(
        'propriedade-invalida',
        `.${ref.prop} só pode ser usado em recursos (ex.: @hp.max)`,
      );
    }
    if (!(RESOURCE_PROPERTIES as readonly string[]).includes(ref.prop)) {
      return report('propriedade-invalida', `Recursos têm .max e .temp, não .${ref.prop}`);
    }
  };

  const visitIs = (args: FormulaNode[], scope: Scope) => {
    const [target, option] = args as [FormulaNode, FormulaNode];
    if (target.type !== 'ref' || option.type !== 'string') {
      return report('is-invalido', 'Use is(@seleção, "opção"), ex.: is(@condicoes, "envenenado")');
    }
    const field = fieldsByKey.get(target.key);
    const select =
      field?.type === 'select'
        ? field
        : field?.type === 'list' && target.prop
          ? itemField(field, target.prop)
          : undefined;
    if (!field) return report('referencia-desconhecida', `Campo inexistente: ${nameOf(target)}`);
    if (select?.type !== 'select' || (field.type === 'select' && target.prop)) {
      return report(
        'is-invalido',
        `is() só funciona com campos de seleção; ${nameOf(target)} não é um`,
      );
    }
    if (field.type === 'list') visitRef(target, scope); // valida a lista/agregação
    if (!select.options.some((o) => o.value === option.value)) {
      const known = select.options.map((o) => `"${o.value}"`).join(', ');
      report(
        'opcao-inexistente',
        `${nameOf(target)} não tem a opção "${option.value}" (opções: ${known})`,
      );
    }
  };

  const visit = (node: FormulaNode, scope: Scope): void => {
    switch (node.type) {
      case 'number':
        return;
      case 'string':
        return report('texto-fora-de-is', 'Textos entre aspas só podem ser usados em is()');
      case 'ref':
        return visitRef(node, scope);
      case 'unary':
        return visit(node.operand, scope);
      case 'binary':
        visit(node.left, scope);
        return visit(node.right, scope);
      case 'call': {
        if (node.fn === 'is') return visitIs(node.args, scope);
        if (node.fn === 'sum' || node.fn === 'count') {
          if (scope) {
            return report(
              'agregacao-aninhada',
              `${node.fn}() não pode ficar dentro de outro sum()/count()`,
            );
          }
          const inner: { list: string | null } = { list: null };
          const before = problems.length;
          for (const arg of node.args) visit(arg, inner);
          // Sem lista e sem outro problema lá dentro (evita mensagens em cascata).
          if (inner.list === null && problems.length === before) {
            report(
              'agregacao-sem-lista',
              `${node.fn}() precisa de um campo de lista, ex.: ${node.fn}(@inventario.peso)`,
            );
          }
          return;
        }
        for (const arg of node.args) visit(arg, scope);
        return;
      }
    }
  };

  visit(ast, null);
  return problems;
}
