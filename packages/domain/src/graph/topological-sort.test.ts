import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { topologicalSort } from './topological-sort';

const graph = (entries: Record<string, string[]>) => new Map(Object.entries(entries));

describe('topologicalSort', () => {
  it('ordena dependências antes dos dependentes', () => {
    const result = topologicalSort(graph({ c: ['b'], b: ['a'], a: [] }));
    expect(result).toEqual({ ok: true, value: ['a', 'b', 'c'] });
  });

  it('ignora dependências que não são nós do grafo (valores de entrada)', () => {
    expect(topologicalSort(graph({ mod: ['for'] }))).toEqual({ ok: true, value: ['mod'] });
  });

  it('detecta autorreferência', () => {
    expect(topologicalSort(graph({ a: ['a'] }))).toEqual({ ok: false, error: ['a', 'a'] });
  });

  it('detecta ciclo indireto e devolve o caminho', () => {
    const result = topologicalSort(graph({ x: ['a'], a: ['b'], b: ['c'], c: ['a'] }));
    expect(result).toEqual({ ok: false, error: ['a', 'b', 'c', 'a'] });
  });

  it('não estoura a pilha em cadeias longas', () => {
    const size = 50_000;
    const chain = new Map(Array.from({ length: size }, (_, i) => [i, i > 0 ? [i - 1] : []]));
    const result = topologicalSort(chain);
    expect(result.ok && result.value.length).toBe(size);
  });

  // Grafo acíclico aleatório: cada nó só depende de nós com índice menor.
  const dagArb = fc
    .integer({ min: 1, max: 30 })
    .chain((size) =>
      fc.tuple(
        ...Array.from({ length: size }, (_, i) =>
          i === 0
            ? fc.constant([])
            : fc.uniqueArray(fc.integer({ min: 0, max: i - 1 }), { maxLength: 4 }),
        ),
      ),
    )
    .map((deps) => new Map(deps.map((d, i) => [i, d as number[]])));

  it('propriedade: em grafos acíclicos, toda dependência vem antes', () => {
    fc.assert(
      fc.property(dagArb, (dag) => {
        const result = topologicalSort(dag);
        if (!result.ok) return false;
        const position = new Map(result.value.map((node, index) => [node, index]));
        expect(result.value).toHaveLength(dag.size);
        for (const [node, deps] of dag) {
          for (const dep of deps)
            expect(position.get(dep)).toBeLessThan(position.get(node) as number);
        }
        return true;
      }),
    );
  });

  it('propriedade: adicionar uma aresta de volta cria ciclo detectado', () => {
    fc.assert(
      fc.property(
        dagArb.filter((dag) => [...dag.values()].some((deps) => deps.length > 0)),
        (dag) => {
          // Pega uma aresta node → dep e adiciona dep → node.
          const [node, deps] = [...dag].find(([, d]) => d.length > 0) as [number, number[]];
          const dep = deps[0] as number;
          dag.set(dep, [...(dag.get(dep) ?? []), node]);
          const result = topologicalSort(dag);
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error[0]).toBe(result.error[result.error.length - 1]);
        },
      ),
    );
  });
});
