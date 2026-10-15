import { deserialize, serialize } from 'node:v8';

/**
 * Clone para o IndexedDB simulado (fake-indexeddb) nos testes.
 *
 * O `structuredClone` do jsdom clona mal arrays de bytes, e o do Node (v8) devolve
 * `Uint8Array` de outro contexto JavaScript. O Dexie decide se um valor é um array de bytes
 * comparando o construtor com o `Uint8Array` global; com outro contexto, ele o copia campo a
 * campo e o estraga. No navegador, banco e página são do mesmo contexto e nada disso
 * acontece. Aqui, clonamos com o v8 e recriamos os arrays de bytes com o construtor global.
 * Precisa vir antes do `fake-indexeddb/auto` (ver `test-setup.ts`).
 */
function withGlobalBytes(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (!value || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const view = value as unknown as ArrayLike<number> & { length: number };
    const copy = new Uint8Array(view.length);
    for (let i = 0; i < view.length; i++) copy[i] = view[i] ?? 0;
    return copy;
  }
  if (seen.has(value)) return seen.get(value);
  // Só objetos e listas simples são percorridos; o resto (Date, Map, Set…) já vem certo.
  const proto: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return value;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const item of value) out.push(withGlobalBytes(item, seen));
    return out;
  }
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [key, item] of Object.entries(value)) out[key] = withGlobalBytes(item, seen);
  return out;
}

globalThis.structuredClone = <T>(value: T): T =>
  withGlobalBytes(deserialize(serialize(value))) as T;
