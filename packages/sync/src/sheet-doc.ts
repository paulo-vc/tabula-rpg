import {
  BonusSchema,
  FieldValueSchema,
  IdSchema,
  PortraitSchema,
  TemplateRefSchema,
  type Bonus,
  type CharacterSheet,
  type FieldValue,
  type Portrait,
  type TemplateRef,
} from '@tabula/domain';
import type * as Y from 'yjs';
import { z } from 'zod';

/**
 * Representação de uma ficha num documento Yjs:
 * - `meta`: id, nome, dono, template e retrato;
 * - `values`: um valor por campo (o último a escrever vence, por campo);
 * - `bonuses`: um bônus por ID (itens, maldições, bênçãos; o último a escrever vence, por bônus).
 *   O dono e o Mestre podem mexer em bônus diferentes ao mesmo tempo sem perder nada.
 *
 * Listas e recursos são valores inteiros: o dono e o Mestre podem alterar a ficha
 * (Fase 7), e se os dois mudarem o MESMO campo ao mesmo tempo, um dos valores vence por
 * inteiro (os dois lados chegam ao mesmo resultado). Campos diferentes nunca se perdem.
 */
export const META = 'meta';
export const VALUES = 'values';
export const BONUSES = 'bonuses';
const PORTRAIT = 'portrait';

/** Retrato da ficha como recebida pela rede (já validado). */
export interface SheetSnapshot {
  id: string;
  name: string;
  ownerId: string;
  templateRef: TemplateRef;
  /** Retrato do personagem, se houver um válido. */
  portrait?: Portrait;
  /** Bônus válidos, em ordem de nome. */
  bonuses: Bonus[];
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
    if (sheet.portrait === undefined) {
      if (meta.has(PORTRAIT)) meta.delete(PORTRAIT);
    } else if (!deepEqual(meta.get(PORTRAIT), sheet.portrait)) {
      meta.set(PORTRAIT, sheet.portrait);
    }
    for (const [fieldId, value] of Object.entries(sheet.values)) {
      if (!deepEqual(values.get(fieldId), value)) values.set(fieldId, value);
    }
    for (const fieldId of [...values.keys()]) {
      if (!Object.hasOwn(sheet.values, fieldId)) values.delete(fieldId);
    }
    writeBonuses(doc, sheet.bonuses ?? []);
  }, origin);
}

/**
 * Escreve os bônus no documento: só os que mudaram, e remove os que não existem mais. Chamado
 * dentro de uma transação (do dono, em `reconcile`, ou do Mestre).
 */
export function writeBonuses(doc: Y.Doc, bonuses: readonly Bonus[]): void {
  const map = doc.getMap<unknown>(BONUSES);
  const wanted = new Map(bonuses.map((bonus) => [bonus.id, bonus]));
  for (const [id, bonus] of wanted) {
    if (!deepEqual(map.get(id), bonus)) map.set(id, bonus);
  }
  for (const id of [...map.keys()]) {
    if (!wanted.has(id)) map.delete(id);
  }
}

/** Lê os bônus do documento, validados (o conteúdo veio de outro participante). */
export function readBonuses(doc: Y.Doc): Bonus[] {
  const bonuses: Bonus[] = [];
  for (const [id, raw] of doc.getMap<unknown>(BONUSES).entries()) {
    const bonus = BonusSchema.safeParse(raw);
    if (bonus.success && bonus.data.id === id) bonuses.push(bonus.data);
  }
  return bonuses.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Lê a ficha do documento, validando tudo (o conteúdo veio de outro participante). */
export function readSheet(doc: Y.Doc): SheetSnapshot | null {
  const metaMap = doc.getMap<unknown>(META);
  const meta = MetaSchema.safeParse(metaMap.toJSON());
  if (!meta.success) return null;
  // Retrato inválido (ou grande demais) é só ignorado: a ficha continua valendo.
  const portrait = PortraitSchema.safeParse(metaMap.get(PORTRAIT));
  const values: Record<string, FieldValue> = {};
  let invalidValues = 0;
  for (const [fieldId, raw] of doc.getMap<unknown>(VALUES).entries()) {
    const key = IdSchema.safeParse(fieldId);
    const value = FieldValueSchema.safeParse(raw);
    if (key.success && value.success) values[fieldId] = value.data;
    else invalidValues++;
  }
  return {
    ...meta.data,
    ...(portrait.success && { portrait: portrait.data }),
    values,
    bonuses: readBonuses(doc),
    invalidValues,
  };
}
