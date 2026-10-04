import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BINARY_OPERATORS,
  collectRefs,
  evaluateFormula,
  MAX_FORMULA_DEPTH,
  MAX_FORMULA_LENGTH,
  parseFormula,
  printFormula,
  type FormulaNode,
  type FormulaRef,
} from './index';

const values: Record<string, number> = {
  for: 16,
  des: 9,
  nivel: 5,
  proficiente: 1,
  hp: 23,
  'hp.max': 40,
  'hp.temp': 0,
};
const resolve = (ref: FormulaRef) => values[ref.prop ? `${ref.key}.${ref.prop}` : ref.key];

function evaluate(source: string) {
  const parsed = parseFormula(source);
  if (!parsed.ok) throw new Error(`erro de parse: ${parsed.error.message}`);
  return evaluateFormula(parsed.value, resolve);
}

const valueOf = (source: string) => {
  const result = evaluate(source);
  if (!result.ok) throw new Error(`erro de avaliação: ${result.error.message}`);
  return result.value;
};

describe('fórmulas: avaliação', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 - 4 - 3', 3],
    ['20 / 2 / 5', 2],
    ['7 % 3', 1],
    ['-3 + 5', 2],
    ['- -3', 3],
    ['+4', 4],
    ['-2 * 3', -6],
    ['2.5 * 2', 5],
    ['floor((@for - 10) / 2)', 3],
    ['floor((@des - 10) / 2)', -1],
    ['ceil(@nivel / 4) + 1', 3],
    ['round(2.5)', 3],
    ['abs(-7)', 7],
    ['min(@for, @des, 12)', 9],
    ['max(@for, @des)', 16],
    ['clamp(@for, 0, 10)', 10],
    ['if(@proficiente, 3, 0) + 2', 5],
    ['if(@nivel >= 5, 10, 1)', 10],
    ['@hp.max - @hp', 17],
    ['@hp + @hp.temp', 23],
    ['@for > @des', 1],
    ['@for == 16', 1],
    ['@for != 16', 0],
    ['1 < 2 == 1', 1],
  ])('%s = %d', (source, expected) => {
    expect(valueOf(source)).toBe(expected);
  });

  it('normaliza -0 para 0', () => {
    expect(Object.is(valueOf('-0'), 0)).toBe(true);
  });

  it('if avalia apenas o ramo escolhido', () => {
    expect(valueOf('if(1, 5, 1 / 0)')).toBe(5);
    expect(valueOf('if(0, @inexistente, 2)')).toBe(2);
  });

  it('reporta divisão por zero', () => {
    expect(evaluate('5 / (@for - 16)')).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'divisao-por-zero' }),
    });
    expect(evaluate('5 % 0')).toMatchObject({ ok: false, error: { code: 'divisao-por-zero' } });
  });

  it('reporta referência indisponível com o nome completo', () => {
    expect(evaluate('@sab + 1')).toMatchObject({
      ok: false,
      error: { code: 'referencia-indefinida', message: 'Valor indisponível: @sab' },
    });
    expect(evaluate('@for.max')).toMatchObject({
      ok: false,
      error: { message: 'Valor indisponível: @for.max' },
    });
  });

  it('reporta resultado não finito', () => {
    const parsed = parseFormula('@enorme * @enorme');
    if (!parsed.ok) throw new Error('parse falhou');
    const result = evaluateFormula(parsed.value, () => 1e200);
    expect(result).toMatchObject({ ok: false, error: { code: 'resultado-invalido' } });
  });
});

describe('fórmulas: erros de sintaxe', () => {
  it.each([
    ['', 'formula-vazia', 0],
    ['   ', 'formula-vazia', 0],
    ['1 + $', 'caractere-invalido', 4],
    ['1 +', 'fim-inesperado', 3],
    ['(1 + 2', 'fim-inesperado', 6],
    ['1 + 2)', 'token-inesperado', 5],
    ['1 2', 'token-inesperado', 2],
    ['* 2', 'token-inesperado', 0],
    ['sqrt(4)', 'funcao-desconhecida', 0],
    ['floor(1, 2)', 'aridade-invalida', 0],
    ['clamp(1)', 'aridade-invalida', 0],
    ['max()', 'aridade-invalida', 0],
    ['@hp.atual', 'propriedade-desconhecida', 0],
    ['@For', 'caractere-invalido', 0],
    ['floor', 'fim-inesperado', 5],
    ['constructor(1)', 'funcao-desconhecida', 0],
  ])('%j → %s na posição %d', (source, code, position) => {
    expect(parseFormula(source)).toEqual({
      ok: false,
      error: expect.objectContaining({ code, position }),
    });
  });

  it('recusa fórmulas longas demais', () => {
    const source = '1+'.repeat(MAX_FORMULA_LENGTH / 2) + '1';
    expect(parseFormula(source)).toMatchObject({
      ok: false,
      error: { code: 'formula-longa-demais' },
    });
  });

  it('recusa aninhamento excessivo sem estourar a pilha', () => {
    const source = '('.repeat(MAX_FORMULA_DEPTH + 1) + '1' + ')'.repeat(MAX_FORMULA_DEPTH + 1);
    expect(parseFormula(source)).toMatchObject({
      ok: false,
      error: { code: 'formula-aninhada-demais' },
    });
  });

  it('aceita aninhamento dentro do limite', () => {
    const depth = MAX_FORMULA_DEPTH - 2;
    expect(parseFormula('('.repeat(depth) + '1' + ')'.repeat(depth)).ok).toBe(true);
  });
});

describe('fórmulas: referências', () => {
  it('coleta todas as referências na ordem', () => {
    const parsed = parseFormula('if(@a > 0, @b.max, min(@c, @a))');
    if (!parsed.ok) throw new Error('parse falhou');
    expect(collectRefs(parsed.value)).toEqual([
      { type: 'ref', key: 'a' },
      { type: 'ref', key: 'b', prop: 'max' },
      { type: 'ref', key: 'c' },
      { type: 'ref', key: 'a' },
    ]);
  });
});

// ---------- Testes de propriedade ----------

const keyArb = fc.constantFrom('for', 'des', 'nivel', 'hp');
const leafArb: fc.Arbitrary<FormulaNode> = fc.oneof(
  fc.integer({ min: 0, max: 1000 }).map((value) => ({ type: 'number' as const, value })),
  fc.integer({ min: 0, max: 9999 }).map((n) => ({ type: 'number' as const, value: n / 100 })),
  keyArb.map((key) => ({ type: 'ref' as const, key })),
  fc.constant({ type: 'ref' as const, key: 'hp', prop: 'max' as const }),
);
const { node: nodeArb } = fc.letrec<{ node: FormulaNode }>((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    leafArb,
    tie('node').map((operand) => ({ type: 'unary' as const, op: '-' as const, operand })),
    fc
      .record({ op: fc.constantFrom(...BINARY_OPERATORS), left: tie('node'), right: tie('node') })
      .map((b) => ({ type: 'binary' as const, ...b })),
    fc
      .record({ fn: fc.constantFrom('floor', 'abs'), arg: tie('node') })
      .map(({ fn, arg }) => ({ type: 'call' as const, fn, args: [arg] })),
    fc
      .array(tie('node'), { minLength: 1, maxLength: 3 })
      .map((args) => ({ type: 'call' as const, fn: 'max' as const, args })),
    fc
      .tuple(tie('node'), tie('node'), tie('node'))
      .map((args) => ({ type: 'call' as const, fn: 'if' as const, args })),
  ),
}));

describe('fórmulas: propriedades', () => {
  it('print → parse reproduz a mesma árvore', () => {
    fc.assert(
      fc.property(nodeArb, (node) => {
        const source = printFormula(node);
        fc.pre(source.length <= MAX_FORMULA_LENGTH);
        const parsed = parseFormula(source);
        fc.pre(parsed.ok || parsed.error.code !== 'formula-aninhada-demais');
        expect(parsed).toEqual({ ok: true, value: node });
      }),
    );
  });

  it('nunca lança exceção para qualquer texto de entrada', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (source) => {
        const parsed = parseFormula(source);
        if (parsed.ok) evaluateFormula(parsed.value, () => 1);
      }),
    );
  });

  it('nunca lança exceção para texto com o vocabulário da linguagem', () => {
    const fragment = fc.constantFrom(
      ...['1', '2.5', '@for', '@hp.max', '+', '-', '*', '/', '%', '<=', '==', '(', ')', ','],
      ...['floor', 'if', 'max', 'clamp', ' '],
    );
    fc.assert(
      fc.property(fc.array(fragment, { maxLength: 40 }), (parts) => {
        const parsed = parseFormula(parts.join(''));
        if (parsed.ok) evaluateFormula(parsed.value, () => 0);
      }),
    );
  });
});
