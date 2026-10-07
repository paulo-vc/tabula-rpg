import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRegistryIndex, type SystemTemplate } from '@tabula/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingest, report, type IngestInput } from './ingest';
import { LICENSE_FROM_FILE, locateFile, parsePublishForm } from './issue-form';
import { applyWrites, buildIndex, readRepo, sha256 } from './repo';

const ATTACHMENT = 'https://github.com/user-attachments/files/123456/ordem.sistema.json';

const system = (version = '1.0.0', change: Partial<SystemTemplate> = {}): SystemTemplate => ({
  id: 'ordem',
  version,
  name: 'Ordem',
  source: 'local',
  fields: [{ id: 'nex', key: 'nex', label: 'NEX', type: 'number' }],
  layouts: { full: [] },
  ...change,
});

/** Corpo gerado pelo GitHub para o formulário `publicar.yml`. */
const issueBody = ({
  file = `[ordem.sistema.json](${ATTACHMENT})`,
  license = 'CC-BY-4.0',
  author = '_No response_',
} = {}) =>
  [
    '### Arquivo do sistema',
    '',
    file,
    '',
    '### Licença',
    '',
    license,
    '',
    '### Autor',
    '',
    author,
    '',
    '### Confirmação',
    '',
    '- [X] Tenho o direito de publicar este conteúdo',
  ].join('\r\n');

describe('formulário de publicação', () => {
  it('lê as respostas e ignora as vazias', () => {
    expect(parsePublishForm(issueBody())).toEqual({
      file: `[ordem.sistema.json](${ATTACHMENT})`,
      license: 'CC-BY-4.0',
      author: undefined,
    });
    expect(parsePublishForm(issueBody({ license: LICENSE_FROM_FILE, author: 'Maria' }))).toEqual(
      expect.objectContaining({ license: undefined, author: 'Maria' }),
    );
    expect(parsePublishForm('texto livre')).toEqual({
      file: '',
      license: undefined,
      author: undefined,
    });
  });

  it.each([
    [`[a.json](${ATTACHMENT})`, { kind: 'anexo', url: ATTACHMENT }],
    ['```json\n{"id": 1}\n```', { kind: 'texto', text: '{"id": 1}' }],
    ['{"id": 1}', { kind: 'texto', text: '{"id": 1}' }],
    ['[a.json](https://exemplo.com/a.json)', null],
    ['https://github.com/user-attachments/files/1/a.zip', null],
    ['', null],
  ])('localiza o arquivo em %j', (field, expected) => {
    expect(locateFile(field)).toEqual(expected);
  });
});

describe('repositório e publicação', () => {
  let root: string;
  let downloads: Map<string, string>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tabula-registro-'));
    downloads = new Map([[ATTACHMENT, JSON.stringify(system())]]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const run = async (change: Partial<IngestInput> = {}) =>
    ingest({
      body: issueBody(),
      submitter: 'maria',
      now: '2026-10-06T12:00:00.000Z',
      repo: await readRepo(root),
      builtinIds: ['dnd5e-srd'],
      download: async (url) => {
        const text = downloads.get(url);
        if (!text) throw new Error('404');
        return text;
      },
      ...change,
    });

  /** Publica e grava no repositório, como o workflow faz ao aceitar o pedido. */
  const publish = async (change: Partial<IngestInput> = {}) => {
    const result = await run(change);
    if (!result.ok) throw new Error(result.error.map((i) => i.message).join('; '));
    await applyWrites(root, result.value.writes);
    return result.value;
  };

  it('grava o arquivo da versão e o registro de posse; o catálogo é gerado deles', async () => {
    const { template } = await publish();
    expect(template).toMatchObject({ source: 'community', license: 'CC-BY-4.0', author: 'maria' });

    const record = JSON.parse(await readFile(join(root, 'templates/ordem/registro.json'), 'utf-8'));
    expect(record).toEqual({
      owner: 'maria',
      versions: { '1.0.0': { publishedAt: '2026-10-06T12:00:00.000Z' } },
    });

    const bytes = await readFile(join(root, 'templates/ordem/1.0.0.json'));
    const index = buildIndex(await readRepo(root));
    expect(index).toMatchObject({
      ok: true,
      value: {
        updatedAt: '2026-10-06T12:00:00.000Z',
        templates: [
          {
            id: 'ordem',
            owner: 'maria',
            versions: [{ version: '1.0.0', sha256: sha256(bytes), size: bytes.byteLength }],
          },
        ],
      },
    });
  });

  it('o catálogo é determinístico e o app consegue lê-lo', async () => {
    await publish();
    const first = buildIndex(await readRepo(root));
    const second = buildIndex(await readRepo(root));
    expect(first).toEqual(second);
    if (!first.ok) throw new Error('falhou');
    expect(parseRegistryIndex(JSON.stringify(first.value)).ok).toBe(true);
  });

  it('nova versão da mesma dona acumula no registro; outra pessoa é recusada', async () => {
    await publish();
    downloads.set(ATTACHMENT, JSON.stringify(system('1.1.0')));
    await publish({ now: '2026-10-07T00:00:00.000Z' });
    const index = buildIndex(await readRepo(root));
    expect(index.ok && index.value.templates[0]?.versions.map((v) => v.version)).toEqual([
      '1.0.0',
      '1.1.0',
    ]);

    downloads.set(ATTACHMENT, JSON.stringify(system('2.0.0')));
    expect(await run({ submitter: 'joao' })).toMatchObject({
      ok: false,
      error: [{ code: 'id-de-outra-pessoa' }],
    });
  });

  it('aceita JSON colado no campo', async () => {
    const body = issueBody({ file: '```json\n' + JSON.stringify(system()) + '\n```' });
    expect(await run({ body })).toMatchObject({ ok: true });
  });

  it.each([
    ['sem arquivo', { body: issueBody({ file: '_No response_' }) }, 'arquivo-ausente'],
    [
      'anexo indisponível',
      { download: async () => Promise.reject(new Error('x')) },
      'download-falhou',
    ],
    ['sem licença', { body: issueBody({ license: LICENSE_FROM_FILE }) }, 'licenca-ausente'],
  ])('recusa: %s', async (_, change, code) => {
    const result = await run(change as Partial<IngestInput>);
    expect(result).toMatchObject({ ok: false, error: [{ code }] });
  });

  it('o relatório explica cada problema', async () => {
    downloads.set(ATTACHMENT, JSON.stringify(system('1.0.0', { id: 'dnd5e-srd' })));
    const text = report(await run());
    expect(text).toContain('❌');
    expect(text).toContain('já vem com o app');
    expect(report(await run({ download: async () => JSON.stringify(system()) }))).toContain(
      '✅ **Ordem** 1.0.0',
    );
  });

  it('detecta arquivo alterado, versão sem registro e lixo no repositório', async () => {
    await publish();
    await applyWrites(root, [
      { path: 'templates/ordem/1.0.0.json', content: JSON.stringify(system('1.0.1')) },
      { path: 'templates/ordem/2.0.0.json', content: JSON.stringify(system('2.0.0')) },
      { path: 'templates/ordem/LEIAME.txt', content: 'oi' },
    ]);
    const result = buildIndex(await readRepo(root));
    expect(result.ok).toBe(false);
    const messages = result.ok ? [] : result.error.map((i) => `${i.path[0]}: ${i.code}`);
    expect(messages).toEqual([
      'templates/ordem/LEIAME.txt: repositorio-invalido',
      'templates/ordem/1.0.0.json: arquivo-trocado',
      'templates/ordem/2.0.0.json: repositorio-invalido',
    ]);
  });

  it('repositório vazio gera catálogo vazio', async () => {
    expect(buildIndex(await readRepo(root))).toMatchObject({ ok: true, value: { templates: [] } });
  });
});
