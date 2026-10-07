/** Comparação de versões semânticas simplificadas (MAJOR.MINOR.PATCH, já validadas). */

export const parseVersion = (version: string) =>
  version.split('.').map(Number) as [number, number, number];

/** Negativo se `a` < `b`, zero se iguais, positivo se `a` > `b`. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  }
  return 0;
}
