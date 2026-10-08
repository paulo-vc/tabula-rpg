import { err, ok, type Result } from '../result';

/**
 * Notação de dados: termos somados ou subtraídos.
 *
 *   1d20+5      2d6 + 1d4 - 1      4d6kh3 (mantém os 3 maiores)      2d20kl1 (o menor)
 *
 * Sem `eval` e com limites (quantidade de dados, faces, tamanho), porque a expressão vem de
 * fichas e sistemas de terceiros.
 */
export const DICE_LIMITS = {
  length: 100,
  terms: 20,
  /** Total de dados rolados numa expressão. */
  dice: 100,
  sides: 1000,
  constant: 1_000_000,
} as const;

export interface DiceTerm {
  kind: 'dados';
  sign: 1 | -1;
  count: number;
  sides: number;
  /** Manter só os maiores (`kh`) ou menores (`kl`). */
  keep?: { mode: 'maiores' | 'menores'; count: number } | undefined;
}

export interface ConstantTerm {
  kind: 'constante';
  sign: 1 | -1;
  value: number;
}

export type DiceExpression = (DiceTerm | ConstantTerm)[];

export interface DiceError {
  code: 'expressao-vazia' | 'expressao-invalida' | 'expressao-grande-demais';
  message: string;
}

const TERM = /^(\d*)d(\d+)(?:(kh|kl)(\d+))?$|^(\d+)$/;

/** Lê uma expressão de dados ("1d20+5"). Espaços são ignorados; "D" vale como "d". */
export function parseDice(source: string): Result<DiceExpression, DiceError> {
  const text = source.replace(/\s+/g, '').toLowerCase();
  if (text === '')
    return err({ code: 'expressao-vazia', message: 'Informe os dados (ex.: 1d20+5)' });
  if (source.length > DICE_LIMITS.length) {
    return err({ code: 'expressao-grande-demais', message: 'Expressão longa demais' });
  }
  const invalid = err<DiceError>({
    code: 'expressao-invalida',
    message: `"${source.trim()}" não é uma rolagem válida (ex.: 2d6+3)`,
  });

  // Separa os termos mantendo o sinal: "1d20-2+1d4" → ["1d20", "-2", "+1d4"].
  const parts = text.match(/[+-]?[^+-]+/g);
  if (!parts || parts.join('') !== text) return invalid;
  if (parts.length > DICE_LIMITS.terms) {
    return err({ code: 'expressao-grande-demais', message: 'Termos demais na rolagem' });
  }

  const terms: DiceExpression = [];
  let totalDice = 0;
  for (const part of parts) {
    const sign: 1 | -1 = part.startsWith('-') ? -1 : 1;
    const body = part.replace(/^[+-]/, '');
    const match = TERM.exec(body);
    if (!match) return invalid;
    if (match[5] !== undefined) {
      const value = Number(match[5]);
      if (value > DICE_LIMITS.constant) return invalid;
      terms.push({ kind: 'constante', sign, value });
      continue;
    }
    const count = match[1] === '' ? 1 : Number(match[1]);
    const sides = Number(match[2]);
    if (count < 1 || sides < 1 || sides > DICE_LIMITS.sides) return invalid;
    totalDice += count;
    if (totalDice > DICE_LIMITS.dice) {
      return err({ code: 'expressao-grande-demais', message: `Mais de ${DICE_LIMITS.dice} dados` });
    }
    const term: DiceTerm = { kind: 'dados', sign, count, sides };
    if (match[3]) {
      const keep = Number(match[4]);
      if (keep < 1 || keep > count) return invalid;
      term.keep = { mode: match[3] === 'kh' ? 'maiores' : 'menores', count: keep };
    }
    terms.push(term);
  }
  return ok(terms);
}

/** Texto canônico da expressão: "1d20 + 5", "4d6kh3 - 1". */
export function printDice(expression: DiceExpression): string {
  return expression
    .map((term, index) => {
      const body =
        term.kind === 'constante'
          ? String(term.value)
          : `${term.count}d${term.sides}${term.keep ? `${term.keep.mode === 'maiores' ? 'kh' : 'kl'}${term.keep.count}` : ''}`;
      if (index === 0) return term.sign < 0 ? `-${body}` : body;
      return `${term.sign < 0 ? '-' : '+'} ${body}`;
    })
    .join(' ');
}

/** Sorteia um inteiro de 1 a `sides` (uniforme). Injetado: criptográfico no app, fixo nos testes. */
export type DieRoller = (sides: number) => number;

export interface DieResult {
  value: number;
  /** Fora dos mantidos (kh/kl): aparece riscado e não soma. */
  dropped: boolean;
}

export type TermResult =
  (DiceTerm & { results: DieResult[]; subtotal: number }) | (ConstantTerm & { subtotal: number });

export interface RollResult {
  expression: string;
  terms: TermResult[];
  total: number;
}

export function rollDice(expression: DiceExpression, roll: DieRoller): RollResult {
  const terms = expression.map((term): TermResult => {
    if (term.kind === 'constante') return { ...term, subtotal: term.sign * term.value };
    const values = Array.from({ length: term.count }, () => roll(term.sides));
    const kept = new Set<number>();
    if (term.keep) {
      // Índices ordenados pelo valor; empate: o primeiro rolado fica.
      const order = values
        .map((value, index) => ({ value, index }))
        .sort((a, b) =>
          term.keep?.mode === 'maiores'
            ? b.value - a.value || a.index - b.index
            : a.value - b.value || a.index - b.index,
        );
      for (const { index } of order.slice(0, term.keep.count)) kept.add(index);
    }
    const results = values.map((value, index) => ({
      value,
      dropped: term.keep !== undefined && !kept.has(index),
    }));
    const sum = results.reduce((total, die) => total + (die.dropped ? 0 : die.value), 0);
    return { ...term, results, subtotal: term.sign * sum };
  });
  return {
    expression: printDice(expression),
    terms,
    total: terms.reduce((total, term) => total + term.subtotal, 0),
  };
}

/** Rolagem de um teste: o dado do sistema (ex.: 1d20) mais o modificador. */
export function checkExpression(checkDice: string, modifier: number): string {
  if (modifier === 0) return checkDice;
  return `${checkDice}${modifier > 0 ? '+' : '-'}${Math.abs(modifier)}`;
}

/** Resumo legível: "1d20 + 5 → [14] + 5 = 19". Dados descartados aparecem entre parênteses. */
export function describeRoll(result: RollResult): string {
  const parts = result.terms.map((term, index) => {
    const body =
      term.kind === 'constante'
        ? String(term.value)
        : `[${term.results.map((die) => (die.dropped ? `(${die.value})` : String(die.value))).join(', ')}]`;
    if (index === 0) return term.sign < 0 ? `-${body}` : body;
    return `${term.sign < 0 ? '-' : '+'} ${body}`;
  });
  return `${result.expression} → ${parts.join(' ')} = ${result.total}`;
}
