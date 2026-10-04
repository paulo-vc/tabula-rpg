import {
  checkCompatibility,
  FORMAT_VERSION,
  parseExport,
  serializeExport,
  type CharacterSheet,
  type Issue,
  type SheetRepository,
  type SystemTemplate,
  type TemplateRepository,
} from '@tabula/domain';
import type { TemplateCatalog } from './catalog';
import { copyName, type Clock, type IdGenerator } from './sheets';

export type ImportResult =
  | { ok: true; kind: 'template'; template: SystemTemplate }
  | { ok: true; kind: 'sheet'; sheet: CharacterSheet; installedTemplate: boolean }
  | { ok: false; issues: Issue[] };

const failure = (code: string, message: string): ImportResult => ({
  ok: false,
  issues: [{ code, path: [], message }],
});

/** Template importado nunca é "nativo": vira local, salvo se veio da comunidade. */
const asInstalled = (template: SystemTemplate): SystemTemplate => ({
  ...template,
  source: template.source === 'community' ? 'community' : 'local',
});

/** Arquivo pronto para salvar. */
export interface ExportFile {
  filename: string;
  content: string;
}

/** Nome de arquivo seguro: "Thorin, o Anão!" → "thorin-o-anao". */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'arquivo';
}

/** Casos de uso de importação e exportação de arquivos. */
export class FileService {
  constructor(
    private readonly sheets: SheetRepository,
    private readonly templates: TemplateRepository,
    private readonly catalog: TemplateCatalog,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** Ficha exportada com o template embutido: o arquivo abre em qualquer instalação. */
  exportSheet(sheet: CharacterSheet, template: SystemTemplate): ExportFile {
    const content = serializeExport({
      kind: 'tabula/sheet',
      formatVersion: FORMAT_VERSION,
      exportedAt: new Date(this.clock.now()).toISOString(),
      payload: sheet,
      template,
    });
    return { filename: `${slugify(sheet.name)}.ficha.json`, content };
  }

  exportTemplate(template: SystemTemplate): ExportFile {
    const content = serializeExport({
      kind: 'tabula/template',
      formatVersion: FORMAT_VERSION,
      exportedAt: new Date(this.clock.now()).toISOString(),
      // Uma cópia exportada de um template nativo, ao ser importada, vira um template local.
      payload: template.source === 'builtin' ? { ...template, source: 'local' } : template,
    });
    return { filename: `${slugify(template.name)}.sistema.json`, content };
  }

  async import(text: string): Promise<ImportResult> {
    const parsed = parseExport(text);
    if (!parsed.ok) return { ok: false, issues: parsed.error };
    const envelope = parsed.value;

    if (envelope.kind === 'tabula/template') {
      const template = asInstalled(envelope.payload);
      if (this.catalog.isBuiltin(template.id)) {
        return failure(
          'template-nativo',
          `"${template.name}" já vem com o app e não pode ser substituído.`,
        );
      }
      const current = await this.templates.get(template.id);
      if (current && checkCompatibility(current, template).kind === 'versao-anterior') {
        return failure(
          'versao-anterior',
          `Você já tem uma versão mais nova de "${template.name}" (${current.version}).`,
        );
      }
      await this.templates.save(template);
      return { ok: true, kind: 'template', template };
    }

    // Ficha: garante que o sistema dela esteja disponível.
    const sheetData = envelope.payload;
    let installedTemplate = false;
    if (!(await this.catalog.get(sheetData.templateRef.id))) {
      const embedded = envelope.template;
      if (!embedded || embedded.id !== sheetData.templateRef.id) {
        return failure(
          'template-ausente',
          'O sistema desta ficha não está instalado e não veio junto no arquivo. Importe o sistema primeiro.',
        );
      }
      await this.templates.save(asInstalled(embedded));
      installedTemplate = true;
    }

    // Nunca sobrescreve uma ficha existente: importa como cópia.
    const exists = await this.sheets.get(sheetData.id);
    const now = this.clock.now();
    const sheet: CharacterSheet = exists
      ? { ...sheetData, id: this.ids.newId(), name: copyName(sheetData.name), updatedAt: now }
      : { ...sheetData, updatedAt: now };
    await this.sheets.save(sheet);
    return { ok: true, kind: 'sheet', sheet, installedTemplate };
  }
}
