import { addField, updateField, type FieldDef } from '@tabula/domain';
import { TabulaDatabase } from '@tabula/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServices, type Services } from './services';

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

describe('TemplateEditorService', () => {
  it('cria um sistema em branco, salva e remove o rascunho', async () => {
    const draft = await services.editor.createBlank('Meu Sistema', 'Ana');
    expect(draft.template).toMatchObject({ id: 'meu-sistema', author: 'Ana', source: 'local' });
    expect(await services.editor.list()).toHaveLength(1);

    const result = await services.editor.save(draft.id);
    expect(result).toMatchObject({ ok: true, bumped: false, template: { version: '1.0.0' } });
    expect(await services.catalog.get('meu-sistema')).toBeDefined();
    expect(await services.editor.list()).toEqual([]);
  });

  it('não repete identificadores de sistemas nem de outros rascunhos', async () => {
    const first = await services.editor.createBlank('Meu Sistema');
    const second = await services.editor.createBlank('Meu Sistema');
    expect(second.template.id).toBe('meu-sistema-2');

    // Renomear o id à mão para um que já existe é recusado ao salvar.
    await services.editor.update(second.id, { ...second.template, id: 'dnd5e-srd' });
    expect(await services.editor.save(second.id)).toMatchObject({
      ok: false,
      issues: [{ code: 'id-em-uso' }],
    });
    expect((await services.editor.save(first.id)).ok).toBe(true);
  });

  it('copia um sistema nativo como sistema local novo', async () => {
    const draft = await services.editor.createCopy('dnd5e-srd');
    expect(draft.template).toMatchObject({
      id: 'd-d-5-edicao-srd-5-1-copia',
      name: 'D&D 5ª Edição (SRD 5.1) (cópia)',
      version: '1.0.0',
      source: 'local',
    });
    expect((await services.editor.save(draft.id)).ok).toBe(true);
  });

  it('o rascunho guarda alterações inválidas; salvar mostra os problemas', async () => {
    const draft = await services.editor.createBlank('Teste');
    const { template } = addField(draft.template, 'computed', 'Total', [0]);
    const broken = updateField(template, {
      ...(template.fields.find((f) => f.id === 'total') as FieldDef & { type: 'computed' }),
      formula: '@nada + ',
    });
    await services.editor.update(draft.id, broken);
    expect((await services.editor.get(draft.id))?.template).toEqual(broken);

    expect(await services.editor.save(draft.id)).toMatchObject({
      ok: false,
      issues: [{ code: 'formula-invalida', path: ['fields', 1, 'formula'] }],
    });
    expect(await services.catalog.get('teste')).toBeUndefined();
  });

  it('editar um sistema salvo aumenta a versão só quando o conteúdo muda', async () => {
    const created = await services.editor.createBlank('Teste');
    await services.editor.save(created.id);

    // Abrir e salvar sem mudar nada mantém a versão.
    const unchanged = await services.editor.edit('teste');
    expect(await services.editor.save(unchanged.id)).toMatchObject({
      ok: true,
      bumped: false,
      template: { version: '1.0.0' },
    });

    const draft = await services.editor.edit('teste');
    await services.editor.update(draft.id, addField(draft.template, 'number', 'For', [0]).template);
    expect(await services.editor.save(draft.id)).toMatchObject({
      ok: true,
      bumped: true,
      template: { version: '1.0.1' },
    });

    // Versão aumentada à mão é respeitada; versão menor é recusada.
    const major = await services.editor.edit('teste');
    await services.editor.update(major.id, { ...major.template, version: '2.0.0', name: 'T2' });
    expect(await services.editor.save(major.id)).toMatchObject({
      ok: true,
      bumped: false,
      template: { version: '2.0.0' },
    });
    const older = await services.editor.edit('teste');
    await services.editor.update(older.id, { ...older.template, version: '1.5.0' });
    expect(await services.editor.save(older.id)).toMatchObject({
      ok: false,
      issues: [{ code: 'versao-anterior' }],
    });
  });

  it('reaproveita o rascunho aberto e não muda o id de um sistema salvo', async () => {
    const created = await services.editor.createBlank('Teste');
    await services.editor.save(created.id);
    const draft = await services.editor.edit('teste');
    expect((await services.editor.edit('teste')).id).toBe(draft.id);

    await services.editor.update(draft.id, { ...draft.template, id: 'outro' });
    expect(await services.editor.save(draft.id)).toMatchObject({
      ok: false,
      issues: [{ code: 'id-alterado' }],
    });
  });

  it('só edita sistemas criados no aparelho', async () => {
    await expect(services.editor.edit('dnd5e-srd')).rejects.toThrow();
  });

  it('fichas existentes migram para a nova versão ao abrir', async () => {
    const created = await services.editor.createBlank('Teste');
    await services.editor.save(created.id);
    const sheet = await services.sheets.create({ name: 'Lia', templateId: 'teste' });

    const draft = await services.editor.edit('teste');
    await services.editor.update(
      draft.id,
      addField(draft.template, 'number', 'Sorte', [0]).template,
    );
    await services.editor.save(draft.id);

    const opened = await services.sheets.open(sheet.id);
    expect(opened).toMatchObject({ status: 'pronta', sheet: { values: { sorte: 0 } } });
  });
});
