import { templatePath, type SystemTemplate } from '@tabula/domain';
import { TabulaDatabase } from '@tabula/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRegistrySource, nodeSha256 } from '@/testing/memory-registry';
import { RegistryError, REGISTRY_REPO } from './registry';
import { webSha256 } from './registry-http';
import { createServices, type Services } from './services';

let db: TabulaDatabase;
let registry: MemoryRegistrySource;
let services: Services;

beforeEach(() => {
  db = new TabulaDatabase(`teste-${crypto.randomUUID()}`);
  registry = new MemoryRegistrySource();
  services = createServices(db, {
    registrySource: registry,
    sha256: nodeSha256,
    appVersion: '0.1.0',
  });
});

afterEach(async () => {
  await db.delete();
});

const system = (version = '1.0.0', change: Partial<SystemTemplate> = {}): SystemTemplate => ({
  id: 'ordem',
  version,
  name: 'Ordem Paranormal (fã)',
  description: 'Investigação e horror',
  author: 'Maria',
  license: 'CC-BY-4.0',
  tags: ['horror', 'investigação'],
  source: 'community',
  fields: [{ id: 'nex', key: 'nex', label: 'NEX', type: 'number', default: 5 }],
  layouts: { full: [] },
  ...change,
});

const entryOf = async (id = 'ordem') => {
  const index = await services.registry.loadIndex();
  const entry = index.templates.find((e) => e.id === id);
  if (!entry) throw new Error(`${id} não está no catálogo`);
  return entry;
};

describe('RegistryService', () => {
  it('instala a versão mais recente do catálogo como sistema da comunidade', async () => {
    registry.publish(system('1.0.0')).publish(system('1.1.0', { name: 'Ordem 1.1' }));
    const result = await services.registry.install(await entryOf());
    expect(result).toMatchObject({ ok: true, template: { version: '1.1.0' } });
    expect(await services.catalog.get('ordem')).toMatchObject({
      name: 'Ordem 1.1',
      source: 'community',
    });
    expect(registry.requests).toContain(templatePath('ordem', '1.1.0'));
  });

  it('acompanha a situação: disponível → instalado → atualização', async () => {
    registry.publish(system('1.0.0'));
    const status = async () =>
      services.registry.statusOf(await entryOf(), await services.catalog.get('ordem'));

    expect(await status()).toEqual({ kind: 'disponivel' });
    await services.registry.install(await entryOf());
    expect(await status()).toEqual({ kind: 'instalado' });

    registry.publish(system('1.2.0'));
    expect(await status()).toEqual({ kind: 'atualizacao', installed: '1.0.0' });
    expect(await services.registry.updates(await services.registry.loadIndex())).toEqual(
      new Map([['ordem', '1.2.0']]),
    );

    await services.registry.install(await entryOf());
    expect(await status()).toEqual({ kind: 'instalado' });
  });

  it('não substitui um sistema nativo nem um criado no aparelho', async () => {
    registry.publish(system('1.0.0', { id: 'dnd5e-srd' }));
    const builtin = await entryOf('dnd5e-srd');
    expect(services.registry.statusOf(builtin, await services.catalog.get('dnd5e-srd'))).toEqual({
      kind: 'conflito',
    });

    registry.publish(system('2.0.0'));
    await services.files.installTemplate(system('1.0.0', { source: 'local', name: 'Meu' }));
    const result = await services.registry.install(await entryOf());
    expect(result).toMatchObject({ ok: false, issues: [{ code: 'conflito' }] });
    expect((await services.catalog.get('ordem'))?.name).toBe('Meu');
  });

  it('recusa sistema que exige um app mais novo', async () => {
    registry.publish(system('1.0.0', { minAppVersion: '0.2.0' }));
    const entry = await entryOf();
    expect(services.registry.statusOf(entry, undefined)).toEqual({
      kind: 'requer-app-novo',
      minAppVersion: '0.2.0',
    });
    expect(await services.registry.install(entry)).toMatchObject({
      ok: false,
      issues: [{ code: 'requer-app-novo' }],
    });
    expect(registry.requests).not.toContain(templatePath('ordem', '1.0.0'));
  });

  it('recusa arquivo que não confere com o hash do catálogo', async () => {
    registry.publish(system('1.0.0'));
    const path = templatePath('ordem', '1.0.0');
    const tampered = registry.files.get(path)?.slice() as Uint8Array;
    tampered[tampered.indexOf('5'.charCodeAt(0))] = '9'.charCodeAt(0); // default: 5 → 9
    registry.files.set(path, tampered);

    expect(await services.registry.install(await entryOf())).toMatchObject({
      ok: false,
      issues: [{ code: 'arquivo-corrompido' }],
    });
    expect(await services.catalog.get('ordem')).toBeUndefined();
  });

  it('sem internet: erro amigável no catálogo e na instalação', async () => {
    registry.publish(system('1.0.0'));
    const entry = await entryOf();
    registry.offline = true;
    await expect(services.registry.loadIndex()).rejects.toEqual(
      expect.objectContaining({ code: 'sem-conexao' }),
    );
    await expect(services.registry.loadIndex()).rejects.toBeInstanceOf(RegistryError);
    expect(await services.registry.install(entry)).toMatchObject({
      ok: false,
      issues: [{ code: 'sem-conexao' }],
    });
  });

  it('catálogo em formato desconhecido pede atualização do app', async () => {
    registry.files.set('index.json', new TextEncoder().encode('{"formatVersion": 2}'));
    await expect(services.registry.loadIndex()).rejects.toEqual(
      expect.objectContaining({ code: 'indice-invalido' }),
    );
  });

  it('busca por nome, etiqueta ou autor, sem acentos', async () => {
    registry.publish(system()).publish(
      system('1.0.0', {
        id: 'mesa',
        name: 'Mesa Rápida',
        description: 'Regras leves',
        tags: ['leve'],
        author: 'João',
      }),
    );
    const index = await services.registry.loadIndex();
    const ids = (query: string) => services.registry.search(index, query).map((e) => e.id);
    expect(ids('')).toEqual(['mesa', 'ordem']);
    expect(ids('INVESTIGACAO')).toEqual(['ordem']);
    expect(ids('joao rapida')).toEqual(['mesa']);
    expect(ids('dragão')).toEqual([]);
  });

  it('o link de publicação abre o formulário com título e autor preenchidos', () => {
    const url = new URL(services.registry.publishUrl(system('1.2.0')));
    expect(url.origin + url.pathname).toBe(
      `https://github.com/${REGISTRY_REPO.owner}/${REGISTRY_REPO.name}/issues/new`,
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      template: 'publicar.yml',
      title: 'Publicar: Ordem Paranormal (fã) 1.2.0',
      autor: 'Maria',
    });
  });

  it('o hash do navegador coincide com o da automação', async () => {
    const bytes = new TextEncoder().encode('Tabula ✓');
    expect(await webSha256(bytes)).toBe(await nodeSha256(bytes));
  });
});
