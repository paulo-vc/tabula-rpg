import { err, ok, type Result } from '../result';

/**
 * Ordena os nós de forma que cada nó venha depois de todas as suas dependências.
 *
 * @param dependencies mapa nó → nós dos quais ele depende. Dependências que não são chaves
 *   do mapa são ignoradas (são valores de entrada, não calculados).
 * @returns a ordem de cálculo, ou o primeiro ciclo encontrado (ex.: ['a', 'b', 'a']).
 */
export function topologicalSort<T>(dependencies: ReadonlyMap<T, readonly T[]>): Result<T[], T[]> {
  const order: T[] = [];
  const state = new Map<T, 'visiting' | 'done'>();

  // DFS iterativa: grafos vindos de arquivos importados não podem estourar a pilha.
  for (const root of dependencies.keys()) {
    if (state.has(root)) continue;
    const stack: { node: T; next: number }[] = [{ node: root, next: 0 }];
    state.set(root, 'visiting');

    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { node: T; next: number };
      const deps = dependencies.get(frame.node) ?? [];

      if (frame.next >= deps.length) {
        stack.pop();
        state.set(frame.node, 'done');
        order.push(frame.node);
        continue;
      }

      const dep = deps[frame.next++] as T;
      if (!dependencies.has(dep) || state.get(dep) === 'done') continue;
      if (state.get(dep) === 'visiting') {
        const start = stack.findIndex((f) => f.node === dep);
        return err([...stack.slice(start).map((f) => f.node), dep]);
      }
      state.set(dep, 'visiting');
      stack.push({ node: dep, next: 0 });
    }
  }
  return ok(order);
}
