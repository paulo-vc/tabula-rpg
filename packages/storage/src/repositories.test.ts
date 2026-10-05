import 'fake-indexeddb/auto';
import {
  compileTemplate,
  createCampaign,
  createSheet,
  type CharacterSheet,
  type SystemTemplate,
} from '@tabula/domain';
import { Dexie, liveQuery } from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TabulaDatabase } from './database';
import {
  DexieCampaignRepository,
  DexieDeviceRepository,
  DexieSheetRepository,
  DexieTemplateRepository,
  InvalidDataError,
} from './repositories';

const template = (overrides: Partial<SystemTemplate> = {}): SystemTemplate => ({
  id: 'meu-sistema',
  version: '1.0.0',
  name: 'Meu Sistema',
  source: 'local',
  fields: [
    { id: 'vida', key: 'vida', label: 'Vida', type: 'resource', default: 10 },
    { id: 'forca', key: 'forca', label: 'Força', type: 'number', default: 1 },
  ],
  layouts: { full: [{ kind: 'field', fieldId: 'vida' }] },
  ...overrides,
});

function sheet(id: string, updatedAt: number, base = template()): CharacterSheet {
  const compiled = compileTemplate(base);
  if (!compiled.ok) throw new Error('template de teste inválido');
  return {
    ...createSheet(compiled.value, { id, name: `Ficha ${id}`, ownerId: 'u1', now: 0 }),
    updatedAt,
  };
}

let db: TabulaDatabase;
let templates: DexieTemplateRepository;
let sheets: DexieSheetRepository;

beforeEach(() => {
  db = new TabulaDatabase(`teste-${crypto.randomUUID()}`);
  templates = new DexieTemplateRepository(db);
  sheets = new DexieSheetRepository(db);
});

afterEach(async () => {
  await db.delete();
});

describe('DexieTemplateRepository', () => {
  it('salva, lê, lista por nome e apaga', async () => {
    await templates.save(template({ id: 'b', name: 'Zumbis' }));
    await templates.save(template({ id: 'a', name: 'Arcano' }));

    expect(await templates.get('a')).toMatchObject({ name: 'Arcano' });
    expect((await templates.list()).map((t) => t.name)).toEqual(['Arcano', 'Zumbis']);

    await templates.delete('a');
    expect(await templates.get('a')).toBeUndefined();
  });

  it('substitui a versão anterior do mesmo template', async () => {
    await templates.save(template());
    await templates.save(template({ version: '1.1.0' }));
    expect(await templates.list()).toHaveLength(1);
    expect((await templates.get('meu-sistema'))?.version).toBe('1.1.0');
  });

  it('descarta propriedades desconhecidas ao gravar', async () => {
    await templates.save({ ...template(), extra: 'lixo' } as SystemTemplate);
    expect(await templates.get('meu-sistema')).not.toHaveProperty('extra');
  });

  it('recusa template que não passa no schema', async () => {
    await expect(templates.save(template({ version: 'um' }))).rejects.toThrow(InvalidDataError);
  });

  it('recusa template com erro semântico (ex.: ciclo de fórmulas)', async () => {
    const cyclic = template({
      fields: [{ id: 'a', key: 'a', label: 'A', type: 'computed', formula: '@a + 1' }],
      layouts: { full: [] },
    });
    await expect(templates.save(cyclic)).rejects.toMatchObject({
      issues: [{ code: 'dependencia-circular' }],
    });
  });

  it('não grava templates nativos', async () => {
    await expect(templates.save(template({ source: 'builtin' }))).rejects.toMatchObject({
      issues: [{ code: 'template-nativo' }],
    });
  });
});

describe('DexieSheetRepository', () => {
  it('salva, lê e apaga', async () => {
    await sheets.save(sheet('s1', 1));
    expect(await sheets.get('s1')).toMatchObject({ name: 'Ficha s1', values: { forca: 1 } });
    await sheets.delete('s1');
    expect(await sheets.get('s1')).toBeUndefined();
  });

  it('lista da alteração mais recente para a mais antiga', async () => {
    await sheets.save(sheet('antiga', 100));
    await sheets.save(sheet('nova', 300));
    await sheets.save(sheet('meio', 200));
    expect((await sheets.list()).map((s) => s.id)).toEqual(['nova', 'meio', 'antiga']);
  });

  it('lista as fichas de um template', async () => {
    await sheets.save(sheet('s1', 1));
    await sheets.save(sheet('s2', 2, template({ id: 'outro' })));
    expect((await sheets.listByTemplate('meu-sistema')).map((s) => s.id)).toEqual(['s1']);
  });

  it('recusa ficha inválida', async () => {
    const invalid = { ...sheet('s1', 1), name: '' };
    await expect(sheets.save(invalid)).rejects.toThrow(InvalidDataError);
    expect(await sheets.get('s1')).toBeUndefined();
  });

  it('notifica consultas reativas quando os dados mudam', async () => {
    const snapshots: string[][] = [];
    const subscription = liveQuery(() => sheets.list()).subscribe((list) =>
      snapshots.push(list.map((s) => s.id)),
    );
    const waitFor = async (length: number) => {
      for (let i = 0; i < 100 && snapshots.length < length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    await waitFor(1);
    await sheets.save(sheet('s1', 1));
    await waitFor(2);
    subscription.unsubscribe();

    expect(snapshots).toEqual([[], ['s1']]);
  });

  it('update altera só os campos informados', async () => {
    await sheets.save(sheet('s1', 1));
    expect(await sheets.update('s1', { values: { forca: 5 }, updatedAt: 2 })).toBe(true);
    expect(await sheets.update('s1', { name: 'Renomeada', updatedAt: 3 })).toBe(true);
    const saved = await sheets.get('s1');
    expect(saved).toMatchObject({ name: 'Renomeada', updatedAt: 3, values: { forca: 5 } });
    expect(saved?.values.vida).toEqual({ current: 10, max: 10 });
  });

  it('update de campos diferentes em paralelo não se sobrescrevem', async () => {
    await sheets.save(sheet('s1', 1));
    await Promise.all([
      sheets.update('s1', { values: { forca: 7 }, updatedAt: 2 }),
      sheets.update('s1', { values: { vida: { current: 3, max: 10 } }, updatedAt: 3 }),
    ]);
    expect((await sheets.get('s1'))?.values).toMatchObject({
      forca: 7,
      vida: { current: 3, max: 10 },
    });
  });

  it('update informa quando a ficha não existe', async () => {
    expect(await sheets.update('fantasma', { name: 'X', updatedAt: 1 })).toBe(false);
  });

  it('update recusa valores inválidos', async () => {
    await sheets.save(sheet('s1', 1));
    await expect(
      sheets.update('s1', { values: { forca: Number.NaN }, updatedAt: 2 }),
    ).rejects.toThrow(InvalidDataError);
    await expect(sheets.update('s1', { name: '', updatedAt: 2 })).rejects.toThrow(InvalidDataError);
  });

  it('dados persistem entre instâncias do banco (reabrir o app)', async () => {
    await sheets.save(sheet('s1', 1));
    db.close();
    const reopened = new TabulaDatabase(db.name);
    expect(await new DexieSheetRepository(reopened).get('s1')).toBeDefined();
    reopened.close();
    await db.open();
  });
});

describe('DexieDeviceRepository', () => {
  it('cria o ID do dispositivo uma vez e o reutiliza', async () => {
    let calls = 0;
    const device = new DexieDeviceRepository(db, () => `id-${++calls}`);
    expect(await device.getDeviceId()).toBe('id-1');
    expect(await device.getDeviceId()).toBe('id-1');
    expect(await new DexieDeviceRepository(db, () => 'outro').getDeviceId()).toBe('id-1');
  });

  it('chamadas simultâneas recebem o mesmo ID', async () => {
    let calls = 0;
    const device = new DexieDeviceRepository(db, () => `id-${++calls}`);
    const ids = await Promise.all([device.getDeviceId(), device.getDeviceId()]);
    expect(new Set(ids).size).toBe(1);
  });
});

describe('DexieCampaignRepository', () => {
  const campaign = (id: string, updatedAt: number) => ({
    ...createCampaign({
      id,
      name: `Campanha ${id}`,
      template: template(),
      gm: { userId: 'u1', displayName: 'Mestre' },
      secret: 'AAAAAAAAAAAAAAAAAAAAAA',
      now: 0,
    }),
    updatedAt,
  });

  it('salva, lista da mais recente para a mais antiga e apaga', async () => {
    const campaigns = new DexieCampaignRepository(db);
    await campaigns.save(campaign('a', 1));
    await campaigns.save(campaign('b', 2));
    expect((await campaigns.list()).map((c) => c.id)).toEqual(['b', 'a']);
    await campaigns.delete('a');
    expect(await campaigns.get('a')).toBeUndefined();
  });

  it('recusa campanha inválida (ex.: segredo malformado)', async () => {
    const campaigns = new DexieCampaignRepository(db);
    await expect(campaigns.save({ ...campaign('a', 1), secret: 'curto' })).rejects.toThrow(
      InvalidDataError,
    );
  });
});

describe('DexieDeviceRepository: nome de exibição', () => {
  it('guarda o último nome usado', async () => {
    const device = new DexieDeviceRepository(db);
    expect(await device.getDisplayName()).toBeUndefined();
    await device.setDisplayName('  Paulo  ');
    expect(await device.getDisplayName()).toBe('Paulo');
  });
});

describe('migração do banco', () => {
  it('atualiza um banco da versão 1 para a 2 sem perder fichas', async () => {
    const name = `v1-${crypto.randomUUID()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({
      templates: 'id, name',
      sheets: 'id, updatedAt, templateRef.id',
      settings: 'key',
    });
    await v1.table('sheets').put(sheet('antiga', 1));
    v1.close();

    const current = new TabulaDatabase(name);
    try {
      expect(await new DexieSheetRepository(current).get('antiga')).toBeDefined();
      expect(await new DexieCampaignRepository(current).list()).toEqual([]);
      expect(current.verno).toBe(2);
    } finally {
      current.close();
      await Dexie.delete(name);
    }
  });
});
