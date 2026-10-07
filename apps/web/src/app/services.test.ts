import 'fake-indexeddb/auto';
import type { SystemTemplate } from '@tabula/domain';
import { TabulaDatabase } from '@tabula/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { slugify } from './files';
import { createServices, type Services } from './services';
import { copyName } from './sheets';

let db: TabulaDatabase;
let services: Services;
let clock: number;
let nextId: number;

beforeEach(() => {
  db = new TabulaDatabase(`teste-${crypto.randomUUID()}`);
  clock = 1_000;
  nextId = 0;
  services = createServices(db, {
    clock: { now: () => clock },
    ids: { newId: () => `id${++nextId}` },
  });
});

afterEach(async () => {
  await db.delete();
});

const homebrew = (version = '1.0.0', extraField = false): SystemTemplate => ({
  id: 'caixa-preta',
  version,
  name: 'Caixa Preta',
  source: 'local',
  fields: [
    { id: 'vigor', key: 'vigor', label: 'Vigor', type: 'number', default: 2 },
    ...(extraField
      ? [{ id: 'sorte', key: 'sorte', label: 'Sorte', type: 'number' as const, default: 3 }]
      : []),
  ],
  layouts: { full: [] },
});

describe('TemplateCatalog', () => {
  it('lista os nativos e os instalados', async () => {
    await services.files.import(services.files.exportTemplate(homebrew()).content);
    const names = (await services.catalog.list()).map((t) => t.name);
    expect(names).toEqual(['D&D 5ª Edição (SRD 5.1)', 'Lendas d20 (ORC)', 'Caixa Preta']);
  });
});

describe('SheetService', () => {
  it('cria uma ficha com o dono local e os padrões do template', async () => {
    const sheet = await services.sheets.create({ name: '  Thorin ', templateId: 'dnd5e-srd' });
    const other = await services.sheets.create({ name: 'Ana', templateId: 'dnd5e-srd' });
    expect(sheet).toMatchObject({ name: 'Thorin', createdAt: 1_000 });
    expect(sheet.ownerId).toBe(other.ownerId); // mesmo dispositivo, mesmo dono
    expect(sheet.ownerId).not.toBe(sheet.id);
    expect(sheet.values.for).toBe(10);
    expect(await services.sheets.open(sheet.id)).toMatchObject({ status: 'pronta' });
  });

  it('altera valores e o nome, atualizando a data', async () => {
    const { id } = await services.sheets.create({ name: 'Thorin', templateId: 'dnd5e-srd' });
    clock = 2_000;
    await services.sheets.setValue(id, 'for', 16);
    await services.sheets.rename(id, 'Thorin II');
    const opened = await services.sheets.open(id);
    expect(opened.status === 'pronta' && opened.sheet).toMatchObject({
      name: 'Thorin II',
      updatedAt: 2_000,
      values: { for: 16 },
    });
  });

  it('duplica e apaga', async () => {
    const original = await services.sheets.create({ name: 'Thorin', templateId: 'dnd5e-srd' });
    const copy = await services.sheets.duplicate(original.id);
    expect(copy).toMatchObject({ name: 'Thorin (cópia)' });
    expect(copy?.id).not.toBe(original.id);
    await services.sheets.delete(original.id);
    expect(await services.sheets.open(original.id)).toEqual({ status: 'nao-encontrada' });
  });

  it('atualiza automaticamente a ficha quando o template recebe uma versão compatível', async () => {
    await services.files.import(services.files.exportTemplate(homebrew()).content);
    const { id } = await services.sheets.create({ name: 'Ana', templateId: 'caixa-preta' });
    await services.files.import(services.files.exportTemplate(homebrew('1.1.0', true)).content);

    const opened = await services.sheets.open(id);
    expect(opened.status).toBe('pronta');
    if (opened.status === 'pronta') {
      expect(opened.sheet.templateRef.version).toBe('1.1.0');
      expect(opened.sheet.values.sorte).toBe(3);
    }
  });

  it('pede confirmação para atualizações incompatíveis (versão MAJOR)', async () => {
    await services.files.import(services.files.exportTemplate(homebrew()).content);
    const { id } = await services.sheets.create({ name: 'Ana', templateId: 'caixa-preta' });
    await services.files.import(services.files.exportTemplate(homebrew('2.0.0', true)).content);

    const opened = await services.sheets.open(id);
    expect(opened.status).toBe('atualizacao-pendente');
    if (opened.status !== 'atualizacao-pendente') return;
    const migrated = await services.sheets.migrate(opened.sheet, opened.compiled);
    expect(migrated.templateRef.version).toBe('2.0.0');
  });

  it('informa quando o sistema da ficha foi removido', async () => {
    await services.files.import(services.files.exportTemplate(homebrew()).content);
    const { id } = await services.sheets.create({ name: 'Ana', templateId: 'caixa-preta' });
    await db.templates.delete('caixa-preta');
    expect(await services.sheets.open(id)).toMatchObject({ status: 'template-ausente' });
  });
});

describe('FileService', () => {
  it('exporta e importa uma ficha (como cópia, sem sobrescrever)', async () => {
    const sheet = await services.sheets.create({ name: 'Thorin', templateId: 'dnd5e-srd' });
    await services.sheets.setValue(sheet.id, 'for', 18);
    const opened = await services.sheets.open(sheet.id);
    if (opened.status !== 'pronta') throw new Error('ficha não abriu');

    const file = services.files.exportSheet(opened.sheet, opened.compiled.template);
    expect(file.filename).toBe('thorin.ficha.json');

    const result = await services.files.import(file.content);
    expect(result).toMatchObject({ ok: true, kind: 'sheet', installedTemplate: false });
    if (result.ok && result.kind === 'sheet') {
      expect(result.sheet.id).not.toBe(sheet.id);
      expect(result.sheet.name).toBe('Thorin (cópia)');
      expect(result.sheet.values.for).toBe(18);
    }
  });

  it('importa a ficha em outra instalação, instalando o sistema embutido no arquivo', async () => {
    await services.files.import(services.files.exportTemplate(homebrew()).content);
    const sheet = await services.sheets.create({ name: 'Ana', templateId: 'caixa-preta' });
    const template = await services.catalog.get('caixa-preta');
    const file = services.files.exportSheet(sheet, template as SystemTemplate);

    const otherDb = new TabulaDatabase(`outra-${crypto.randomUUID()}`);
    const other = createServices(otherDb);
    try {
      const result = await other.files.import(file.content);
      expect(result).toMatchObject({ ok: true, kind: 'sheet', installedTemplate: true });
      expect(result.ok && result.kind === 'sheet' && result.sheet.id).toBe(sheet.id);
      expect(await other.catalog.get('caixa-preta')).toBeDefined();
    } finally {
      await otherDb.delete();
    }
  });

  it('exportar um template nativo gera uma cópia local importável', async () => {
    const dnd = await services.catalog.get('dnd5e-srd');
    const file = services.files.exportTemplate(dnd as SystemTemplate);
    expect(JSON.parse(file.content).payload.source).toBe('local');
    expect(await services.files.import(file.content)).toMatchObject({
      ok: false,
      issues: [{ code: 'template-nativo' }],
    });
  });

  it('não rebaixa um sistema instalado para uma versão anterior', async () => {
    await services.files.import(services.files.exportTemplate(homebrew('1.2.0')).content);
    const result = await services.files.import(
      services.files.exportTemplate(homebrew('1.1.0')).content,
    );
    expect(result).toMatchObject({ ok: false, issues: [{ code: 'versao-anterior' }] });
    expect((await services.catalog.get('caixa-preta'))?.version).toBe('1.2.0');
  });

  it('repassa os problemas de arquivos inválidos', async () => {
    expect(await services.files.import('não é json')).toMatchObject({
      ok: false,
      issues: [{ code: 'json-invalido' }],
    });
  });
});

describe('utilitários', () => {
  it.each([
    ['Thorin, o Anão!', 'thorin-o-anao'],
    ['  Ação & Reação  ', 'acao-reacao'],
    ['???', 'arquivo'],
  ])('slugify(%j) = %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('copyName respeita o limite de 100 caracteres', () => {
    expect(copyName('a'.repeat(100))).toHaveLength(100);
    expect(copyName('a'.repeat(100)).endsWith(' (cópia)')).toBe(true);
  });
});
