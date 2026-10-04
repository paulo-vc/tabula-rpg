/**
 * Linguagem de fórmulas das fichas.
 *
 *   floor((@for - 10) / 2)
 *   @nivel * 2 + @con_mod
 *   if(@proficiente, @bonus_prof, 0) + @des_mod
 *   @hp.max - @hp
 *
 * Referências usam a `key` do campo, prefixada por `@`. Recursos (`resource`) são referenciados
 * pelo valor atual (`@hp`) ou por uma propriedade (`@hp.max`, `@hp.temp`). Booleanos valem 1 ou 0.
 * Comparações (`<`, `>=`, `==`, …) também resultam em 1 ou 0.
 */

export const BINARY_OPERATORS = [
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '<=',
  '>',
  '>=',
  '==',
  '!=',
] as const;
export type BinaryOperator = (typeof BINARY_OPERATORS)[number];

export const REF_PROPERTIES = ['max', 'temp'] as const;
export type RefProperty = (typeof REF_PROPERTIES)[number];

/** Funções disponíveis e sua aridade (mínimo e máximo de argumentos). */
export const FUNCTIONS = {
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  round: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  min: { min: 1, max: Infinity },
  max: { min: 1, max: Infinity },
  clamp: { min: 3, max: 3 },
  if: { min: 3, max: 3 },
} as const satisfies Record<string, { min: number; max: number }>;
export type FunctionName = keyof typeof FUNCTIONS;

export type FormulaNode =
  | { type: 'number'; value: number }
  | { type: 'ref'; key: string; prop?: RefProperty }
  | { type: 'unary'; op: '-'; operand: FormulaNode }
  | { type: 'binary'; op: BinaryOperator; left: FormulaNode; right: FormulaNode }
  | { type: 'call'; fn: FunctionName; args: FormulaNode[] };

export type FormulaRef = Extract<FormulaNode, { type: 'ref' }>;

export interface FormulaError {
  code:
    | 'formula-vazia'
    | 'formula-longa-demais'
    | 'formula-aninhada-demais'
    | 'caractere-invalido'
    | 'token-inesperado'
    | 'fim-inesperado'
    | 'funcao-desconhecida'
    | 'aridade-invalida'
    | 'propriedade-desconhecida';
  message: string;
  /** Posição (índice do caractere) onde o erro foi detectado. */
  position: number;
}
