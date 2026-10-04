import {
  CharacterSheetSchema,
  compileTemplate,
  SystemTemplateSchema,
  type CharacterSheet,
  type Issue,
  type SheetRepository,
  type SystemTemplate,
  type TemplateRepository,
} from '@tabula/domain';
import type { TabulaDatabase } from './database';

/** Tentativa de gravar dados inválidos. Indica um bug: os casos de uso validam antes. */
export class InvalidDataError extends Error {
  constructor(
    message: string,
    readonly issues: Issue[],
  ) {
    super(`${message}: ${issues.map((issue) => issue.message).join('; ')}`);
    this.name = 'InvalidDataError';
  }
}

const zodIssues = (issues: { message: string; path: PropertyKey[] }[]): Issue[] =>
  issues.map((issue) => ({
    code: 'schema-invalido',
    message: issue.message,
    path: issue.path.filter((p): p is string | number => typeof p !== 'symbol'),
  }));

export class DexieTemplateRepository implements TemplateRepository {
  constructor(private readonly db: TabulaDatabase) {}

  async save(template: SystemTemplate): Promise<void> {
    const parsed = SystemTemplateSchema.safeParse(template);
    if (!parsed.success) {
      throw new InvalidDataError('Template inválido', zodIssues(parsed.error.issues));
    }
    if (parsed.data.source === 'builtin') {
      // Templates nativos vêm do próprio app (@tabula/templates) e não são gravados.
      throw new InvalidDataError('Template inválido', [
        {
          code: 'template-nativo',
          path: ['source'],
          message: 'Templates nativos não são gravados',
        },
      ]);
    }
    const compiled = compileTemplate(parsed.data);
    if (!compiled.ok) throw new InvalidDataError('Template inválido', compiled.error);
    await this.db.templates.put(parsed.data);
  }

  get(id: string): Promise<SystemTemplate | undefined> {
    return this.db.templates.get(id);
  }

  list(): Promise<SystemTemplate[]> {
    return this.db.templates.orderBy('name').toArray();
  }

  async delete(id: string): Promise<void> {
    await this.db.templates.delete(id);
  }
}

export class DexieSheetRepository implements SheetRepository {
  constructor(private readonly db: TabulaDatabase) {}

  async save(sheet: CharacterSheet): Promise<void> {
    const parsed = CharacterSheetSchema.safeParse(sheet);
    if (!parsed.success) {
      throw new InvalidDataError('Ficha inválida', zodIssues(parsed.error.issues));
    }
    await this.db.sheets.put(parsed.data);
  }

  get(id: string): Promise<CharacterSheet | undefined> {
    return this.db.sheets.get(id);
  }

  list(): Promise<CharacterSheet[]> {
    return this.db.sheets.orderBy('updatedAt').reverse().toArray();
  }

  listByTemplate(templateId: string): Promise<CharacterSheet[]> {
    return this.db.sheets.where('templateRef.id').equals(templateId).toArray();
  }

  async delete(id: string): Promise<void> {
    await this.db.sheets.delete(id);
  }
}
