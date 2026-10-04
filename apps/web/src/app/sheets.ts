import {
  checkCompatibility,
  createSheet,
  migrateSheet,
  type CharacterSheet,
  type CompiledTemplate,
  type DeviceRepository,
  type FieldValue,
  type SheetRepository,
} from '@tabula/domain';
import type { TemplateCatalog } from './catalog';

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  newId(): string;
}

/** Estado de uma ficha aberta, já reconciliada com o template disponível. */
export type OpenedSheet =
  | { status: 'pronta'; sheet: CharacterSheet; compiled: CompiledTemplate }
  /** O template mudou de versão MAJOR: a migração precisa de confirmação do usuário. */
  | { status: 'atualizacao-pendente'; sheet: CharacterSheet; compiled: CompiledTemplate }
  | { status: 'template-ausente'; sheet: CharacterSheet }
  | { status: 'nao-encontrada' };

/** Casos de uso das fichas. */
export class SheetService {
  constructor(
    private readonly sheets: SheetRepository,
    private readonly catalog: TemplateCatalog,
    private readonly device: DeviceRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async create(input: { name: string; templateId: string }): Promise<CharacterSheet> {
    const template = await this.catalog.get(input.templateId);
    if (!template) throw new Error(`Sistema não encontrado: ${input.templateId}`);
    const sheet = createSheet(this.catalog.compile(template), {
      id: this.ids.newId(),
      name: input.name.trim(),
      ownerId: await this.device.getDeviceId(),
      now: this.clock.now(),
    });
    await this.sheets.save(sheet);
    return sheet;
  }

  /**
   * Carrega a ficha e a reconcilia com o template instalado. Atualizações compatíveis
   * (mesma versão MAJOR) são aplicadas automaticamente, sem perda de dados.
   */
  async open(id: string): Promise<OpenedSheet> {
    const sheet = await this.sheets.get(id);
    if (!sheet) return { status: 'nao-encontrada' };
    const template = await this.catalog.get(sheet.templateRef.id);
    if (!template) return { status: 'template-ausente', sheet };
    const compiled = this.catalog.compile(template);

    const compatibility = checkCompatibility(sheet.templateRef, template);
    if (compatibility.kind === 'atualizacao') {
      if (compatibility.breaking) return { status: 'atualizacao-pendente', sheet, compiled };
      return { status: 'pronta', sheet: await this.migrate(sheet, compiled), compiled };
    }
    return { status: 'pronta', sheet, compiled };
  }

  async migrate(sheet: CharacterSheet, compiled: CompiledTemplate): Promise<CharacterSheet> {
    const { sheet: migrated } = migrateSheet(sheet, compiled, this.clock.now());
    await this.sheets.save(migrated);
    return migrated;
  }

  async setValue(id: string, fieldId: string, value: FieldValue): Promise<void> {
    await this.sheets.update(id, { values: { [fieldId]: value }, updatedAt: this.clock.now() });
  }

  async rename(id: string, name: string): Promise<void> {
    await this.sheets.update(id, { name: name.trim(), updatedAt: this.clock.now() });
  }

  async duplicate(id: string): Promise<CharacterSheet | undefined> {
    const sheet = await this.sheets.get(id);
    if (!sheet) return undefined;
    const now = this.clock.now();
    const copy: CharacterSheet = {
      ...structuredClone(sheet),
      id: this.ids.newId(),
      name: copyName(sheet.name),
      createdAt: now,
      updatedAt: now,
    };
    await this.sheets.save(copy);
    return copy;
  }

  delete(id: string): Promise<void> {
    return this.sheets.delete(id);
  }
}

/** "Thorin" → "Thorin (cópia)", respeitando o limite de tamanho do nome. */
export function copyName(name: string): string {
  const suffix = ' (cópia)';
  return name.slice(0, 100 - suffix.length) + suffix;
}
