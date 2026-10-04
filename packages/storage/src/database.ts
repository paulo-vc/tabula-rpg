import type { CharacterSheet, SystemTemplate } from '@tabula/domain';
import { Dexie, type EntityTable } from 'dexie';

export const DEFAULT_DATABASE_NAME = 'tabula';

/**
 * Banco local (IndexedDB). É a fonte da verdade do app (ADR 0003).
 *
 * Mudanças de schema exigem uma nova chamada a `this.version(n)` com a migração
 * correspondente; versões anteriores nunca são editadas.
 */
export class TabulaDatabase extends Dexie {
  templates!: EntityTable<SystemTemplate, 'id'>;
  sheets!: EntityTable<CharacterSheet, 'id'>;

  constructor(name: string = DEFAULT_DATABASE_NAME) {
    super(name);
    this.version(1).stores({
      templates: 'id, name',
      sheets: 'id, updatedAt, templateRef.id',
    });
  }
}
