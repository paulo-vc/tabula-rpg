import { err, ok, type Result } from '../result';
import {
  FUNCTIONS,
  REF_PROPERTIES,
  type BinaryOperator,
  type FormulaError,
  type FormulaNode,
  type FunctionName,
  type RefProperty,
} from './ast';

/** Limites contra arquivos importados maliciosos ou degenerados. */
export const MAX_FORMULA_LENGTH = 500;
export const MAX_FORMULA_DEPTH = 32;

type Token =
  | { kind: 'number'; value: number; position: number }
  | { kind: 'ref'; key: string; prop: string | undefined; position: number }
  | { kind: 'ident'; name: string; position: number }
  | { kind: 'op'; op: BinaryOperator; position: number }
  | { kind: 'punct'; char: '(' | ')' | ','; position: number }
  | { kind: 'end'; position: number };

class FormulaSyntaxError extends Error {
  constructor(readonly detail: FormulaError) {
    super(detail.message);
  }
}

const fail = (code: FormulaError['code'], message: string, position: number): never => {
  throw new FormulaSyntaxError({ code, message, position });
};

const WHITESPACE = /\s+/y;
const TOKEN_PATTERNS: [RegExp, (match: RegExpExecArray, position: number) => Token][] = [
  [/\d+(?:\.\d+)?/y, (m, position) => ({ kind: 'number', value: Number(m[0]), position })],
  [
    /@([a-z][a-z0-9_]*)(?:\.([a-z]+))?/y,
    (m, position) => ({ kind: 'ref', key: m[1] as string, prop: m[2], position }),
  ],
  [/[a-z]+/y, (m, position) => ({ kind: 'ident', name: m[0], position })],
  [
    /<=|>=|==|!=|[+\-*/%<>]/y,
    (m, position) => ({ kind: 'op', op: m[0] as BinaryOperator, position }),
  ],
  [/[(),]/y, (m, position) => ({ kind: 'punct', char: m[0] as '(' | ')' | ',', position })],
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  outer: while (position < source.length) {
    WHITESPACE.lastIndex = position;
    if (WHITESPACE.test(source)) {
      position = WHITESPACE.lastIndex;
      continue;
    }
    for (const [pattern, build] of TOKEN_PATTERNS) {
      pattern.lastIndex = position;
      const match = pattern.exec(source);
      if (!match) continue;
      tokens.push(build(match, position));
      position = pattern.lastIndex;
      continue outer;
    }
    fail('caractere-invalido', `Caractere inválido: "${source[position]}"`, position);
  }
  tokens.push({ kind: 'end', position });
  return tokens;
}

/** Precedência dos operadores binários: maior = liga mais forte. */
const PRECEDENCE: Record<BinaryOperator, number> = {
  '<': 1,
  '<=': 1,
  '>': 1,
  '>=': 1,
  '==': 1,
  '!=': 1,
  '+': 2,
  '-': 2,
  '*': 3,
  '/': 3,
  '%': 3,
};
const UNARY_PRECEDENCE = 4;

/** Parser Pratt. Nunca usa `eval` nem `Function`. */
class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): FormulaNode {
    const node = this.expression(0);
    const next = this.peek();
    if (next.kind !== 'end') this.unexpected(next);
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index] as Token;
  }

  private advance(): Token {
    return this.tokens[this.index++] as Token;
  }

  private unexpected(token: Token): never {
    if (token.kind === 'end')
      return fail('fim-inesperado', 'A fórmula terminou antes do esperado', token.position);
    return fail('token-inesperado', 'Símbolo inesperado na fórmula', token.position);
  }

  private atPunct(char: '(' | ')' | ','): boolean {
    const token = this.peek();
    return token.kind === 'punct' && token.char === char;
  }

  private expectPunct(char: '(' | ')' | ','): void {
    const token = this.advance();
    if (token.kind !== 'punct' || token.char !== char) this.unexpected(token);
  }

  private expression(minPrecedence: number): FormulaNode {
    if (++this.depth > MAX_FORMULA_DEPTH) {
      fail(
        'formula-aninhada-demais',
        'A fórmula tem níveis demais de aninhamento',
        this.peek().position,
      );
    }
    let left = this.prefix();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'op' || PRECEDENCE[token.op] <= minPrecedence) break;
      this.advance();
      const right = this.expression(PRECEDENCE[token.op]);
      left = { type: 'binary', op: token.op, left, right };
    }
    this.depth--;
    return left;
  }

  private prefix(): FormulaNode {
    const token = this.advance();
    switch (token.kind) {
      case 'number':
        return { type: 'number', value: token.value };
      case 'ref':
        return this.ref(token);
      case 'ident':
        return this.call(token);
      case 'op':
        if (token.op === '-')
          return { type: 'unary', op: '-', operand: this.expression(UNARY_PRECEDENCE) };
        if (token.op === '+') return this.expression(UNARY_PRECEDENCE);
        return this.unexpected(token);
      case 'punct': {
        if (token.char !== '(') return this.unexpected(token);
        const inner = this.expression(0);
        this.expectPunct(')');
        return inner;
      }
      case 'end':
        return this.unexpected(token);
    }
  }

  private ref(token: Extract<Token, { kind: 'ref' }>): FormulaNode {
    if (token.prop === undefined) return { type: 'ref', key: token.key };
    if (!(REF_PROPERTIES as readonly string[]).includes(token.prop)) {
      fail(
        'propriedade-desconhecida',
        `Propriedade desconhecida ".${token.prop}" (use ${REF_PROPERTIES.map((p) => `.${p}`).join(' ou ')})`,
        token.position,
      );
    }
    return { type: 'ref', key: token.key, prop: token.prop as RefProperty };
  }

  private call(token: Extract<Token, { kind: 'ident' }>): FormulaNode {
    if (!Object.hasOwn(FUNCTIONS, token.name)) {
      fail('funcao-desconhecida', `Função desconhecida: ${token.name}`, token.position);
    }
    const fn = token.name as FunctionName;
    this.expectPunct('(');
    const args: FormulaNode[] = [];
    if (!this.atPunct(')')) {
      args.push(this.expression(0));
      while (this.atPunct(',')) {
        this.advance();
        args.push(this.expression(0));
      }
    }
    this.expectPunct(')');
    const arity = FUNCTIONS[fn];
    if (args.length < arity.min || args.length > arity.max) {
      const expected =
        arity.min === arity.max
          ? `${arity.min}`
          : arity.max === Infinity
            ? `${arity.min} ou mais`
            : `${arity.min} a ${arity.max}`;
      fail(
        'aridade-invalida',
        `${fn}() espera ${expected} argumento(s), recebeu ${args.length}`,
        token.position,
      );
    }
    return { type: 'call', fn, args };
  }
}

export function parseFormula(source: string): Result<FormulaNode, FormulaError> {
  if (source.length > MAX_FORMULA_LENGTH) {
    return err({
      code: 'formula-longa-demais',
      message: `A fórmula excede ${MAX_FORMULA_LENGTH} caracteres`,
      position: MAX_FORMULA_LENGTH,
    });
  }
  if (source.trim() === '')
    return err({ code: 'formula-vazia', message: 'A fórmula está vazia', position: 0 });
  try {
    return ok(new Parser(tokenize(source)).parse());
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return err(error.detail);
    throw error;
  }
}
