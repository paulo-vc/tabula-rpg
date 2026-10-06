import { err, ok, type Result } from '../result';
import type { FormulaNode, FormulaRef } from './ast';

export interface EvaluationError {
  code: 'referencia-indefinida' | 'divisao-por-zero' | 'resultado-invalido';
  message: string;
}

/** Devolve o valor numérico de uma referência, ou `undefined` se ela não puder ser resolvida. */
export type RefResolver = (ref: FormulaRef) => number | undefined;

/**
 * O que a avaliação precisa saber sobre a ficha. Valores ausentes (`undefined`) viram o erro
 * `referencia-indefinida`.
 */
export interface FormulaEnvironment {
  /** Valor numérico de um campo que não é lista (número, booleano, recurso, seleção…). */
  scalar(ref: FormulaRef): number | undefined;
  /** Opções marcadas de uma seleção; `item` quando é um campo de item de lista. */
  selection(ref: FormulaRef, item?: number): readonly string[] | undefined;
  /** Quantidade de itens, se `key` for uma lista; `undefined` se não for. */
  listLength(key: string): number | undefined;
  /** Valor numérico de `@lista.campo` no item `item`. */
  itemValue(ref: FormulaRef, item: number): number | undefined;
}

type BinaryNode = Extract<FormulaNode, { type: 'binary' }>;
type CallNode = Extract<FormulaNode, { type: 'call' }>;
/** Item da lista sendo avaliado dentro de `sum()`/`count()`. */
type ItemContext = { list: string; index: number } | null;

class EvaluationFailure extends Error {
  constructor(readonly detail: EvaluationError) {
    super(detail.message);
  }
}

const bool = (value: boolean): number => (value ? 1 : 0);

const refName = (ref: FormulaRef) => (ref.prop ? `@${ref.key}.${ref.prop}` : `@${ref.key}`);

const undefinedRef = (ref: FormulaRef): never => {
  throw new EvaluationFailure({
    code: 'referencia-indefinida',
    message: `Valor indisponível: ${refName(ref)}`,
  });
};

/** Uma função simples (só campos numéricos) também serve de ambiente. */
function toEnvironment(source: RefResolver | FormulaEnvironment): FormulaEnvironment {
  if (typeof source !== 'function') return source;
  return {
    scalar: source,
    selection: () => undefined,
    listLength: () => undefined,
    itemValue: () => undefined,
  };
}

class Evaluator {
  constructor(private readonly env: FormulaEnvironment) {}

  evaluate(node: FormulaNode, item: ItemContext): number {
    switch (node.type) {
      case 'number':
        return node.value;
      case 'string':
        // Textos só existem como 2º argumento de is() (garantido ao compilar o template).
        throw new EvaluationFailure({
          code: 'resultado-invalido',
          message: 'Texto fora de is()',
        });
      case 'ref':
        return this.ref(node, item);
      case 'unary':
        return -this.evaluate(node.operand, item);
      case 'binary':
        return this.binary(node, item);
      case 'call':
        return this.call(node, item);
    }
  }

  private ref(ref: FormulaRef, item: ItemContext): number {
    if (this.env.listLength(ref.key) !== undefined) {
      // Lista: só dentro de sum()/count(), no item atual.
      if (!item || item.list !== ref.key) return undefinedRef(ref);
      if (ref.prop === undefined) return 1; // cada item conta 1: count(@lista), sum(@lista)
      return this.env.itemValue(ref, item.index) ?? undefinedRef(ref);
    }
    return this.env.scalar(ref) ?? undefinedRef(ref);
  }

  private binary(node: BinaryNode, item: ItemContext): number {
    const left = this.evaluate(node.left, item);
    const right = this.evaluate(node.right, item);
    switch (node.op) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
      case '%':
        if (right === 0) {
          throw new EvaluationFailure({ code: 'divisao-por-zero', message: 'Divisão por zero' });
        }
        return node.op === '/' ? left / right : left % right;
      case '<':
        return bool(left < right);
      case '<=':
        return bool(left <= right);
      case '>':
        return bool(left > right);
      case '>=':
        return bool(left >= right);
      case '==':
        return bool(left === right);
      case '!=':
        return bool(left !== right);
    }
  }

  private call(node: CallNode, item: ItemContext): number {
    switch (node.fn) {
      case 'if': {
        // Avaliação preguiçosa: só o ramo escolhido é calculado.
        const [condition, whenTrue, whenFalse] = node.args as [
          FormulaNode,
          FormulaNode,
          FormulaNode,
        ];
        return this.evaluate(this.evaluate(condition, item) !== 0 ? whenTrue : whenFalse, item);
      }
      case 'is':
        return this.is(node, item);
      case 'sum':
      case 'count':
        return this.aggregate(node);
    }
    // A aridade já foi garantida pelo parser.
    const args = node.args.map((arg) => this.evaluate(arg, item));
    const first = args[0] as number;
    switch (node.fn) {
      case 'floor':
        return Math.floor(first);
      case 'ceil':
        return Math.ceil(first);
      case 'round':
        return Math.round(first);
      case 'abs':
        return Math.abs(first);
      case 'min':
        return Math.min(...args);
      case 'max':
        return Math.max(...args);
      case 'clamp':
        return Math.min(Math.max(first, args[1] as number), args[2] as number);
    }
  }

  private is(node: CallNode, item: ItemContext): number {
    const [target, option] = node.args as [FormulaNode, FormulaNode];
    if (target.type !== 'ref' || option.type !== 'string') {
      throw new EvaluationFailure({ code: 'resultado-invalido', message: 'Uso inválido de is()' });
    }
    const inItem = item && item.list === target.key ? item.index : undefined;
    const selected = this.env.selection(target, inItem) ?? undefinedRef(target);
    return bool(selected.includes(option.value));
  }

  /** sum()/count(): avalia a expressão para cada item da lista que ela referencia. */
  private aggregate(node: CallNode): number {
    const expression = node.args[0] as FormulaNode;
    const list = this.listOf(expression);
    const length = list === undefined ? undefined : this.env.listLength(list);
    if (list === undefined || length === undefined) {
      throw new EvaluationFailure({
        code: 'resultado-invalido',
        message: `${node.fn}() precisa de um campo de lista`,
      });
    }
    let total = 0;
    for (let index = 0; index < length; index++) {
      const value = this.evaluate(expression, { list, index });
      total += node.fn === 'count' ? bool(value !== 0) : value;
    }
    return total;
  }

  private listOf(node: FormulaNode): string | undefined {
    switch (node.type) {
      case 'ref':
        return this.env.listLength(node.key) === undefined ? undefined : node.key;
      case 'unary':
        return this.listOf(node.operand);
      case 'binary':
        return this.listOf(node.left) ?? this.listOf(node.right);
      case 'call':
        // Agregações internas não definem a lista desta (não são permitidas, de qualquer forma).
        if (node.fn === 'sum' || node.fn === 'count') return undefined;
        for (const arg of node.args) {
          const list = this.listOf(arg);
          if (list) return list;
        }
        return undefined;
      default:
        return undefined;
    }
  }
}

export function evaluateFormula(
  node: FormulaNode,
  environment: RefResolver | FormulaEnvironment,
): Result<number, EvaluationError> {
  try {
    const value = new Evaluator(toEnvironment(environment)).evaluate(node, null);
    if (!Number.isFinite(value)) {
      return err({
        code: 'resultado-invalido',
        message: 'A fórmula não resultou em um número válido',
      });
    }
    // Normaliza -0 para 0 (evita "-0" na interface).
    return ok(value === 0 ? 0 : value);
  } catch (error) {
    if (error instanceof EvaluationFailure) return err(error.detail);
    throw error;
  }
}
