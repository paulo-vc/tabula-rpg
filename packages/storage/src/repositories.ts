import {
  CampaignSchema,
  CharacterSheetSchema,
  compileTemplate,
  SystemTemplateSchema,
  type Campaign,
  type CampaignRepository,
  type CharacterSheet,
  type DeviceRepository,
  type DraftRepository,
  FieldValueSchema,
  type FieldValue,
  type Issue,
  LOG_LIMIT,
  RollEntrySchema,
  type RollEntry,
  type RollLogRepository,
  type SecretValuesRecord,
  type SecretValuesRepository,
  type SessionStateRecord,
  type SessionStateRepository,
  type SheetChanges,
  type SheetRepository,
  type SystemTemplate,
  type TemplateDraft,
  type TemplateRepository,
} from '@tabula/domain';
import { Dexie, type UpdateSpec } from 'dexie';
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

  async update(id: string, changes: SheetChanges): Promise<boolean> {
    const parsed = SheetChangesSchema.safeParse(changes);
    if (!parsed.success) {
      throw new InvalidDataError('Alteração inválida', zodIssues(parsed.error.issues));
    }
    const { name, values, updatedAt } = parsed.data;
    // Caminhos `values.<id>` alteram só aqueles campos. IDs não contêm ".", então são seguros.
    const spec: Record<string, unknown> = { updatedAt };
    if (name !== undefined) spec.name = name;
    for (const [fieldId, value] of Object.entries(values ?? {})) spec[`values.${fieldId}`] = value;
    const updated = await this.db.sheets.update(id, spec as UpdateSpec<CharacterSheet>);
    return updated > 0;
  }

  async delete(id: string): Promise<void> {
    await this.db.sheets.delete(id);
  }
}

const SheetChangesSchema = CharacterSheetSchema.pick({
  name: true,
  values: true,
  updatedAt: true,
}).partial({ name: true, values: true });

export class DexieCampaignRepository implements CampaignRepository {
  constructor(private readonly db: TabulaDatabase) {}

  async save(campaign: Campaign): Promise<void> {
    const parsed = CampaignSchema.safeParse(campaign);
    if (!parsed.success) {
      throw new InvalidDataError('Campanha inválida', zodIssues(parsed.error.issues));
    }
    await this.db.campaigns.put(parsed.data);
  }

  get(id: string): Promise<Campaign | undefined> {
    return this.db.campaigns.get(id);
  }

  list(): Promise<Campaign[]> {
    return this.db.campaigns.orderBy('updatedAt').reverse().toArray();
  }

  async delete(id: string): Promise<void> {
    await this.db.campaigns.delete(id);
  }
}

export class DexieSessionStateRepository implements SessionStateRepository {
  constructor(private readonly db: TabulaDatabase) {}

  list(campaignId: string): Promise<SessionStateRecord[]> {
    return this.db.sessionStates.where('campaignId').equals(campaignId).toArray();
  }

  async save(records: SessionStateRecord[]): Promise<void> {
    await this.db.sessionStates.bulkPut(records);
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    await this.db.sessionStates.where('campaignId').equals(campaignId).delete();
  }
}

const DEVICE_ID_KEY = 'deviceId';
const DISPLAY_NAME_KEY = 'displayName';

export class DexieDeviceRepository implements DeviceRepository {
  constructor(
    private readonly db: TabulaDatabase,
    private readonly generateId: () => string = () => crypto.randomUUID(),
  ) {}

  getDeviceId(): Promise<string> {
    // Transação: duas abas abrindo o app ao mesmo tempo não geram IDs diferentes.
    return this.db.transaction('rw', this.db.settings, async () => {
      const existing = await this.db.settings.get(DEVICE_ID_KEY);
      if (typeof existing?.value === 'string') return existing.value;
      const id = this.generateId();
      await this.db.settings.put({ key: DEVICE_ID_KEY, value: id });
      return id;
    });
  }

  async getDisplayName(): Promise<string | undefined> {
    const setting = await this.db.settings.get(DISPLAY_NAME_KEY);
    return typeof setting?.value === 'string' ? setting.value : undefined;
  }

  async setDisplayName(name: string): Promise<void> {
    await this.db.settings.put({ key: DISPLAY_NAME_KEY, value: name.trim().slice(0, 100) });
  }
}

/**
 * Rascunhos do criador de sistemas. Não são validados: podem estar incompletos enquanto
 * o usuário edita. A validação acontece ao salvar o sistema.
 */
export class DexieDraftRepository implements DraftRepository {
  constructor(private readonly db: TabulaDatabase) {}

  async save(draft: TemplateDraft): Promise<void> {
    await this.db.drafts.put(draft);
  }

  get(id: string): Promise<TemplateDraft | undefined> {
    return this.db.drafts.get(id);
  }

  list(): Promise<TemplateDraft[]> {
    return this.db.drafts.orderBy('updatedAt').reverse().toArray();
  }

  async delete(id: string): Promise<void> {
    await this.db.drafts.delete(id);
  }
}

export class DexieSecretValuesRepository implements SecretValuesRepository {
  constructor(private readonly db: TabulaDatabase) {}

  get(campaignId: string, sheetId: string): Promise<SecretValuesRecord | undefined> {
    return this.db.secretValues.get([campaignId, sheetId]);
  }

  async update(
    campaignId: string,
    sheetId: string,
    values: Record<string, FieldValue>,
    updatedAt: number,
  ): Promise<void> {
    for (const [fieldId, value] of Object.entries(values)) {
      const parsed = FieldValueSchema.safeParse(value);
      if (!parsed.success) {
        throw new InvalidDataError(
          `Valor secreto inválido em ${fieldId}`,
          zodIssues(parsed.error.issues),
        );
      }
    }
    await this.db.transaction('rw', this.db.secretValues, async () => {
      const current = await this.db.secretValues.get([campaignId, sheetId]);
      await this.db.secretValues.put({
        campaignId,
        sheetId,
        values: { ...current?.values, ...values },
        updatedAt,
      });
    });
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    await this.db.secretValues.where('campaignId').equals(campaignId).delete();
  }
}

export class DexieRollLogRepository implements RollLogRepository {
  constructor(private readonly db: TabulaDatabase) {}

  async list(campaignId: string): Promise<RollEntry[]> {
    const records = await this.db.rollLog
      .where('[campaignId+at]')
      .between([campaignId, Dexie.minKey], [campaignId, Dexie.maxKey])
      .toArray();
    return records.map((record) => record.entry);
  }

  async add(campaignId: string, entries: readonly RollEntry[]): Promise<void> {
    for (const entry of entries) {
      const parsed = RollEntrySchema.safeParse(entry);
      if (!parsed.success) {
        throw new InvalidDataError('Rolagem inválida', zodIssues(parsed.error.issues));
      }
    }
    await this.db.transaction('rw', this.db.rollLog, async () => {
      for (const entry of entries) {
        const exists = await this.db.rollLog.get([campaignId, entry.id]);
        if (!exists) await this.db.rollLog.put({ campaignId, id: entry.id, at: entry.at, entry });
      }
      // Mantém só as mais recentes.
      const keys = await this.db.rollLog
        .where('[campaignId+at]')
        .between([campaignId, Dexie.minKey], [campaignId, Dexie.maxKey])
        .primaryKeys();
      const excess = keys.length - LOG_LIMIT;
      if (excess > 0) await this.db.rollLog.bulkDelete(keys.slice(0, excess));
    });
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    await this.db.rollLog.where('campaignId').equals(campaignId).delete();
  }
}
