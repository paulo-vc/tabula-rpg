import { z } from 'zod';
import { IdSchema, LabelSchema } from '../schema/primitives';
import { DICE_LIMITS, printDice, type DiceExpression } from './dice';

/** Quantas entradas cada campanha guarda no registro (as mais antigas saem). */
export const LOG_LIMIT = 200;

/** Quantas entradas recentes o Mestre envia a quem entra no meio da sessão. */
export const LOG_CATCH_UP = 50;

const SignSchema = z.union([z.literal(1), z.literal(-1)]);
const Int = (min: number, max: number) => z.number().int().min(min).max(max);

const TermResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('dados'),
    sign: SignSchema,
    count: Int(1, DICE_LIMITS.dice),
    sides: Int(1, DICE_LIMITS.sides),
    keep: z
      .object({ mode: z.enum(['maiores', 'menores']), count: Int(1, DICE_LIMITS.dice) })
      .optional(),
    results: z
      .array(z.object({ value: Int(1, DICE_LIMITS.sides), dropped: z.boolean() }))
      .max(DICE_LIMITS.dice),
    subtotal: z.number().int(),
  }),
  z.object({
    kind: z.literal('constante'),
    sign: SignSchema,
    value: Int(0, DICE_LIMITS.constant),
    subtotal: z.number().int(),
  }),
]);

const RawRollSchema = z.object({
  expression: z.string().max(200),
  terms: z.array(TermResultSchema).min(1).max(DICE_LIMITS.terms),
  total: z.number().int(),
});
type RawRoll = z.infer<typeof RawRollSchema>;

const RollResultSchema = RawRollSchema.refine(isConsistent, 'Rolagem inconsistente');

/**
 * Uma rolagem no registro da sessão. Vem de outros participantes: o formato e a conta são
 * conferidos (dados dentro das faces, somas certas). Quem rola é quem sorteia — numa mesa
 * entre amigos, o mesmo que rolar dados de verdade na frente de todos.
 */
export const RollEntrySchema = z.object({
  id: IdSchema,
  at: z.number().int().nonnegative(),
  authorId: IdSchema,
  authorName: LabelSchema,
  /** O que foi rolado: "Atletismo", "Espada longa: dano"… */
  label: z.string().max(120),
  result: RollResultSchema,
  /** Rolagem secreta do Mestre: não sai do aparelho dele. */
  secret: z.boolean(),
});
export type RollEntry = z.infer<typeof RollEntrySchema>;

/** Confere que o resultado é a soma dos dados declarados (e só deles). */
function isConsistent(result: RawRoll): boolean {
  let total = 0;
  for (const term of result.terms) {
    if (term.kind === 'constante') {
      if (term.subtotal !== term.sign * term.value) return false;
    } else {
      if (term.results.length !== term.count) return false;
      if (term.results.some((die) => die.value > term.sides)) return false;
      const dropped = term.results.filter((die) => die.dropped).length;
      const keep = term.keep?.count ?? term.count;
      if (keep > term.count || dropped !== term.count - keep) return false;
      const sum = term.results.reduce((s, die) => s + (die.dropped ? 0 : die.value), 0);
      if (term.subtotal !== term.sign * sum) return false;
    }
    total += term.subtotal;
  }
  const expression: DiceExpression = result.terms.map((term) =>
    term.kind === 'constante'
      ? { kind: 'constante', sign: term.sign, value: term.value }
      : {
          kind: 'dados',
          sign: term.sign,
          count: term.count,
          sides: term.sides,
          ...(term.keep && { keep: term.keep }),
        },
  );
  return total === result.total && printDice(expression) === result.expression;
}
