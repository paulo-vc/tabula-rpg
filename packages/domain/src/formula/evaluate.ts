import { err, ok, type Result } from '../result';
import type { FormulaNode, FormulaRef } from './ast';

export interface EvaluationError {
  code: 'referencia-indefinida' | 'divisao-por-zero' | 'resultado-invalido';
  message: string;
}

/** Devolve o valor numérico de uma referência, ou `undefined` se ela não puder ser resolvida. */
export type RefResolver = (ref: FormulaRef) => number | undefined;

type BinaryNode = Extract<FormulaNode, { type: 'binary' }>;
type CallNode = Extract<FormulaNode, { type: 'call' }>;

class EvaluationFailure extends Error {
  constructor(readonly detail: EvaluationError) {
    super(detail.message);
  }
}

const bool = (value: boolean): number => (value ? 1 : 0);

function evaluateNode(node: FormulaNode, resolve: RefResolver): number {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'ref': {
      const value = resolve(node);
      if (value === undefined) {
        const name = node.prop ? `@${node.key}.${node.prop}` : `@${node.key}`;
        throw new EvaluationFailure({
          code: 'referencia-indefinida',
          message: `Valor indisponível: ${name}`,
        });
      }
      return value;
    }
    case 'unary':
      return -evaluateNode(node.operand, resolve);
    case 'binary':
      return evaluateBinary(node, resolve);
    case 'call':
      return evaluateCall(node, resolve);
  }
}

function evaluateBinary(node: BinaryNode, resolve: RefResolver): number {
  const left = evaluateNode(node.left, resolve);
  const right = evaluateNode(node.right, resolve);
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

function evaluateCall(node: CallNode, resolve: RefResolver): number {
  if (node.fn === 'if') {
    // Avaliação preguiçosa: só o ramo escolhido é calculado.
    const [condition, whenTrue, whenFalse] = node.args as [FormulaNode, FormulaNode, FormulaNode];
    return evaluateNode(evaluateNode(condition, resolve) !== 0 ? whenTrue : whenFalse, resolve);
  }
  // A aridade já foi garantida pelo parser.
  const args = node.args.map((arg) => evaluateNode(arg, resolve));
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

export function evaluateFormula(
  node: FormulaNode,
  resolve: RefResolver,
): Result<number, EvaluationError> {
  try {
    const value = evaluateNode(node, resolve);
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
