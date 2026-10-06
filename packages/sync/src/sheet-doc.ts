import {
  FieldValueSchema,
  IdSchema,
  TemplateRefSchema,
  type CharacterSheet,
  type FieldValue,
  type TemplateRef,
} from '@tabula/domain';
import type * as Y from 'yjs';
import { z } from 'zod';

/**
 * Representação de uma ficha num documento Yjs:
 * - `meta`: id, nome, dono e template;
 * - `values`: um valor por campo (o último a escrever vence, por campo).
 *
 * Listas e recursos são valores inteiros (um item da lista não é mesclado com outro):
 * na v0.1 só o dono escreve na ficha, então não há edição concorrente dentro de um valor.
 */
export const META = 'meta';
export const VALUES = 'values';

/** Retrato da ficha como recebida pela rede (já validado). */
export interface SheetSnapshot {
  id: string;
  name: string;
  ownerId: string;
  templateRef: TemplateRef;
  values: Record<string, FieldValue>;
  /** Quantos valores recebidos foram descartados por serem inválidos. */
  invalidValues: number;
}

const MetaSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(100),
  ownerId: IdSchema,
  templateRef: TemplateRefSchema,
});

/** Comparação estrutural de valores JSON (a ordem das chaves não importa). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.hasOwn(b, key) &&
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * Escreve no documento apenas o que difere da ficha local (e remove campos que não existem
 * mais). Escrever só a diferença, e só depois de o documento conhecer o estado mais recente,
 * garante que as escritas sejam posteriores às antigas — e portanto vençam.
 */
export function reconcile(doc: Y.Doc, sheet: CharacterSheet, origin?: unknown): void {
  const meta = doc.getMap<unknown>(META);
  const values = doc.getMap<unknown>(VALUES);
  doc.transact(() => {
    const wantedMeta: Record<string, unknown> = {
      id: sheet.id,
      name: sheet.name,
      ownerId: sheet.ownerId,
      templateRef: sheet.templateRef,
    };
    for (const [key, value] of Object.entries(wantedMeta)) {
      if (!deepEqual(meta.get(key), value)) meta.set(key, value);
    }
    for (const [fieldId, value] of Object.entries(sheet.values)) {
      if (!deepEqual(values.get(fieldId), value)) values.set(fieldId, value);
    }
    for (const fieldId of [...values.keys()]) {
      if (!Object.hasOwn(sheet.values, fieldId)) values.delete(fieldId);
    }
  }, origin);
}

/** Lê a ficha do documento, validando tudo (o conteúdo veio de outro participante). */
export function readSheet(doc: Y.Doc): SheetSnapshot | null {
  const meta = MetaSchema.safeParse(doc.getMap<unknown>(META).toJSON());
  if (!meta.success) return null;
  const values: Record<string, FieldValue> = {};
  let invalidValues = 0;
  for (const [fieldId, raw] of doc.getMap<unknown>(VALUES).entries()) {
    const key = IdSchema.safeParse(fieldId);
    const value = FieldValueSchema.safeParse(raw);
    if (key.success && value.success) values[fieldId] = value.data;
    else invalidValues++;
  }
  return { ...meta.data, values, invalidValues };
}
