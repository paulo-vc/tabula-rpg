import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkExpression,
  describeRoll,
  DICE_LIMITS,
  parseDice,
  printDice,
  rollDice,
  type DieRoller,
} from './dice';
import { RollEntrySchema, type RollEntry } from './log';

/** Dados "viciados" para os testes: devolvem a sequência dada. */
const sequence = (...values: number[]): DieRoller => {
  let index = 0;
  return () => values[index++ % values.length] as number;
};

const roll = (source: string, roller: DieRoller) => {
  const parsed = parseDice(source);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return rollDice(parsed.value, roller);
};

describe('parseDice', () => {
  it.each([
    ['1d20+5', '1d20 + 5'],
    ['d20', '1d20'],
    ['2D6 + 1d4 - 1', '2d6 + 1d4 - 1'],
    ['4d6kh3', '4d6kh3'],
    ['2d20kl1+3', '2d20kl1 + 3'],
    ['-1+1d8', '-1 + 1d8'],
    ['10', '10'],
  ])('%s → %s', (source, printed) => {
    const parsed = parseDice(source);
    expect(parsed.ok && printDice(parsed.value)).toBe(printed);
  });

  it.each([
    ['', 'expressao-vazia'],
    ['   ', 'expressao-vazia'],
    ['1d20+', 'expressao-invalida'],
    ['+', 'expressao-invalida'],
    ['--1', 'expressao-invalida'],
    ['0d6', 'expressao-invalida'],
    ['1d0', 'expressao-invalida'],
    ['1d1001', 'expressao-invalida'],
    ['4d6kh5', 'expressao-invalida'],
    ['4d6kh0', 'expressao-invalida'],
    ['1d20*2', 'expressao-invalida'],
    ['abc', 'expressao-invalida'],
    ['101d6', 'expressao-grande-demais'],
    ['60d6+60d6', 'expressao-grande-demais'],
    ['1+'.repeat(60) + '1', 'expressao-grande-demais'],
  ])('recusa %j (%s)', (source, code) => {
    expect(parseDice(source)).toMatchObject({ ok: false, error: { code } });
  });

  it('nunca lança exceção', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (source) => {
        parseDice(source);
      }),
    );
  });
});

describe('rollDice', () => {
  it('soma dados e constantes', () => {
    const result = roll('2d6 + 1d4 - 1', sequence(3, 5, 2));
    expect(result.total).toBe(3 + 5 + 2 - 1);
    expect(describeRoll(result)).toBe('2d6 + 1d4 - 1 → [3, 5] + [2] - 1 = 9');
  });

  it('mantém os maiores ou os menores (empate: o primeiro rolado)', () => {
    const high = roll('4d6kh3', sequence(2, 6, 2, 4));
    expect(high.total).toBe(12);
    expect(describeRoll(high)).toBe('4d6kh3 → [2, 6, (2), 4] = 12');
    expect(roll('2d20kl1+3', sequence(17, 4)).total).toBe(7);
  });

  it('teste: dado do sistema mais o modificador', () => {
    expect(checkExpression('1d20', 5)).toBe('1d20+5');
    expect(checkExpression('2d12', -1)).toBe('2d12-1');
    expect(checkExpression('1d20', 0)).toBe('1d20');
  });

  it('o resultado fica sempre entre o mínimo e o máximo da expressão', () => {
    const term = fc.record({
      count: fc.integer({ min: 1, max: 5 }),
      sides: fc.integer({ min: 1, max: 20 }),
      minus: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(term, { minLength: 1, maxLength: 4 }), fc.nat(), (terms, seed) => {
        const source = terms.map((t) => `${t.minus ? '-' : '+'}${t.count}d${t.sides}`).join('');
        let state = seed;
        const random: DieRoller = (sides) => {
          state = (state * 1103515245 + 12345) % 2 ** 31;
          return (state % sides) + 1;
        };
        const result = roll(source, random);
        const min = terms.reduce((s, t) => s + (t.minus ? -t.count * t.sides : t.count), 0);
        const max = terms.reduce((s, t) => s + (t.minus ? -t.count : t.count * t.sides), 0);
        expect(result.total).toBeGreaterThanOrEqual(min);
        expect(result.total).toBeLessThanOrEqual(max);
      }),
    );
  });
});

describe('RollEntrySchema', () => {
  const entry = (source = '4d6kh3+2', values = [2, 6, 2, 4]): RollEntry => ({
    id: 'r1',
    at: 1,
    authorId: 'ana',
    authorName: 'Ana',
    label: 'Força',
    result: roll(source, sequence(...values)),
    secret: false,
  });

  it('aceita uma rolagem feita pelo app', () => {
    expect(RollEntrySchema.safeParse(entry()).success).toBe(true);
  });

  it.each<[string, (e: RollEntry) => void]>([
    ['total adulterado', (e) => (e.result.total = 99)],
    [
      'dado acima das faces',
      (e) => {
        const term = e.result.terms[0];
        if (term?.kind === 'dados') term.results[0] = { value: 7, dropped: false };
      },
    ],
    [
      'subtotal que não bate',
      (e) => {
        const term = e.result.terms[0];
        if (term?.kind === 'dados') term.subtotal = 1;
      },
    ],
    [
      'dados a mais',
      (e) => {
        const term = e.result.terms[0];
        if (term?.kind === 'dados') term.results.push({ value: 1, dropped: true });
      },
    ],
    ['expressão diferente dos termos', (e) => (e.result.expression = '1d20')],
    ['sem termos', (e) => (e.result.terms = [])],
  ])('recusa %s', (_, change) => {
    const tampered = structuredCloneJson(entry());
    change(tampered);
    expect(RollEntrySchema.safeParse(tampered).success).toBe(false);
  });

  it('limites protegem contra rolagens enormes vindas da rede', () => {
    const huge = entry(`${DICE_LIMITS.dice}d6`, [1]);
    expect(RollEntrySchema.safeParse(huge).success).toBe(true);
    const term = huge.result.terms[0];
    if (term?.kind === 'dados') term.results.push({ value: 1, dropped: false });
    expect(RollEntrySchema.safeParse(huge).success).toBe(false);
  });
});

const structuredCloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
