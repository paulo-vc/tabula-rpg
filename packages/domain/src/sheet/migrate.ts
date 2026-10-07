import type { CompiledTemplate } from '../template/compile';
import { compareVersions, parseVersion } from '../version';
import type { SystemTemplate, TemplateRef } from '../template/schema';
import type { CharacterSheet, FieldValue, SheetValues } from './schema';
import { defaultValue, valueProblem } from './values';

export type Compatibility =
  /** Mesma versão: nada a fazer. */
  | { kind: 'mesma-versao' }
  /** Template mais novo. `breaking` quando muda a versão MAJOR (o usuário deve confirmar). */
  | { kind: 'atualizacao'; breaking: boolean }
  /** Template mais antigo que o da ficha: não rebaixar automaticamente. */
  | { kind: 'versao-anterior' }
  /** Outro sistema: a ficha não serve para este template. */
  | { kind: 'outro-sistema' };

/** Compara a referência de uma ficha com um template (ex.: o template oficial de uma campanha). */
export function checkCompatibility(ref: TemplateRef, template: SystemTemplate): Compatibility {
  if (ref.id !== template.id) return { kind: 'outro-sistema' };
  const comparison = compareVersions(template.version, ref.version);
  if (comparison === 0) return { kind: 'mesma-versao' };
  if (comparison < 0) return { kind: 'versao-anterior' };
  return {
    kind: 'atualizacao',
    breaking: parseVersion(template.version)[0] !== parseVersion(ref.version)[0],
  };
}

export interface MigrationReport {
  /** Campos novos que receberam o valor padrão. */
  added: string[];
  /** Campos removidos ou com tipo incompatível, guardados em `orphaned`. */
  orphaned: string[];
  /** Campos que voltaram a existir e tiveram o valor recuperado de `orphaned`. */
  restored: string[];
}

/**
 * Adapta os valores de uma ficha a outra versão do mesmo template, sem perder dados:
 *
 * - campo mantido com valor compatível → valor preservado;
 * - campo removido, que virou calculado ou com valor incompatível → movido para `orphaned`;
 * - campo novo → valor padrão, ou o valor guardado em `orphaned` se ele for compatível.
 *
 * Como os valores são indexados por ID estável, renomear rótulos ou apelidos não afeta a ficha.
 */
export function migrateSheet(
  sheet: CharacterSheet,
  target: CompiledTemplate,
  now: number,
): { sheet: CharacterSheet; report: MigrationReport } {
  const report: MigrationReport = { added: [], orphaned: [], restored: [] };
  const values = new Map<string, FieldValue>();
  const orphaned = new Map<string, FieldValue>(Object.entries(sheet.orphaned ?? {}));

  for (const [fieldId, value] of Object.entries(sheet.values)) {
    const field = target.fieldsById.get(fieldId);
    if (field && valueProblem(field, value) === undefined) {
      values.set(fieldId, value);
    } else {
      orphaned.set(fieldId, value);
      report.orphaned.push(fieldId);
    }
  }

  for (const field of target.template.fields) {
    if (values.has(field.id)) continue;
    const saved = orphaned.get(field.id);
    if (saved !== undefined && valueProblem(field, saved) === undefined) {
      values.set(field.id, saved);
      orphaned.delete(field.id);
      if (!report.orphaned.includes(field.id)) report.restored.push(field.id);
      continue;
    }
    const value = defaultValue(field);
    if (value !== undefined) {
      values.set(field.id, value);
      report.added.push(field.id);
    }
  }

  const { template } = target;
  const { orphaned: _previous, ...rest } = sheet;
  const migrated: CharacterSheet = {
    ...rest,
    templateRef: { id: template.id, version: template.version, source: template.source },
    values: Object.fromEntries(values) as SheetValues,
    updatedAt: now,
  };
  if (orphaned.size > 0) migrated.orphaned = Object.fromEntries(orphaned);

  return { sheet: migrated, report };
}
