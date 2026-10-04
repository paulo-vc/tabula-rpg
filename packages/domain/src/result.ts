/** Resultado de uma operação que pode falhar de forma esperada (sem exceções). */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const err = <E>(error: E): { ok: false; error: E } => ({ ok: false, error });

/** Problema encontrado ao validar um template, ficha ou arquivo importado. */
export interface Issue {
  /** Identificador estável do problema, para a UI traduzir ou tratar. */
  code: string;
  /** Caminho até o elemento com problema, ex.: ['fields', 3, 'formula']. */
  path: (string | number)[];
  /** Mensagem legível (pt-BR). */
  message: string;
}
