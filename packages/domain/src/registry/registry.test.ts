import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION } from '../format';
import { clone, miniTemplate } from '../testing/fixtures';
import type { SystemTemplate } from '../template/schema';
import {
  addVersion,
  parseRegistryIndex,
  parseTemplateFile,
  prepareSubmission,
  serializeIndex,
  serializeTemplateFile,
  type SubmissionContext,
} from './operations';
import { emptyIndex, latestVersion, MAX_TEMPLATE_BYTES, type RegistryIndex } from './schema';

const NOW = '2026-10-06T12:00:00.000Z';
const HASH = 'a'.repeat(64);

const template = (change: Partial<SystemTemplate> = {}): SystemTemplate => ({
  ...clone(miniTemplate()),
  ...change,
});

const envelope = (payload: unknown) =>
  JSON.stringify({
    kind: 'tabula/template',
    formatVersion: FORMAT_VERSION,
    exportedAt: NOW,
    payload,
  });

const context = (change: Partial<SubmissionContext> = {}): SubmissionContext => ({
  index: emptyIndex(NOW),
  submitter: 'maria',
  builtinIds: ['dnd5e-srd'],
  ...change,
});

const publish = (index: RegistryIndex, t: SystemTemplate, owner = 'maria', publishedAt = NOW) =>
  addVersion(index, t, { sha256: HASH, size: 100, publishedAt, owner });

const codesOf = (text: string, ctx = context()) => {
  const result = prepareSubmission(text, ctx);
  return result.ok ? [] : result.error.map((i) => i.code);
};

describe('prepareSubmission', () => {
  it('aceita o arquivo exportado pelo app e marca o sistema como da comunidade', () => {
    const result = prepareSubmission(envelope(template({ source: 'local' })), context());
    expect(result).toMatchObject({ ok: true, value: { id: 'mini-5e', source: 'community' } });
  });

  it('aceita o template puro', () => {
    expect(prepareSubmission(JSON.stringify(template()), context()).ok).toBe(true);
  });

  it('as respostas do formulário prevalecem; sem autor, usa a conta do GitHub', () => {
    const noAuthor = template({ license: 'CC0-1.0' });
    const result = prepareSubmission(envelope(noAuthor), context({ license: ' OGL-1.0a ' }));
    expect(result).toMatchObject({ ok: true, value: { license: 'OGL-1.0a', author: 'maria' } });

    const named = prepareSubmission(envelope(noAuthor), context({ author: 'Maria Silva' }));
    expect(named).toMatchObject({ ok: true, value: { license: 'CC0-1.0', author: 'Maria Silva' } });
  });

  it('exige licença', () => {
    const { license: _, ...withoutLicense } = template();
    expect(codesOf(envelope(withoutLicense))).toEqual(['licenca-ausente']);
    expect(codesOf(envelope(withoutLicense), context({ license: '  ' }))).toEqual([
      'licenca-ausente',
    ]);
  });

  it.each([
    ['não é JSON', '{', ['json-invalido']],
    [
      'ficha no lugar do sistema',
      JSON.stringify({ kind: 'tabula/sheet' }),
      ['ficha-em-vez-de-sistema'],
    ],
    ['lista', '[]', ['schema-invalido']],
    ['envelope sem conteúdo', JSON.stringify({ kind: 'tabula/template' }), ['schema-invalido']],
    ['grande demais', ' '.repeat(MAX_TEMPLATE_BYTES + 1), ['arquivo-grande-demais']],
  ])('recusa arquivo inválido: %s', (_, text, codes) => {
    expect(codesOf(text)).toEqual(codes);
  });

  it('recusa template com fórmula inválida', () => {
    const broken = template();
    broken.fields.push({ id: 'x', key: 'x', label: 'X', type: 'computed', formula: '@sab + 1' });
    expect(codesOf(envelope(broken))).toEqual(['referencia-desconhecida']);
  });

  it('recusa o id de um sistema nativo', () => {
    expect(codesOf(envelope(template({ id: 'dnd5e-srd' })))).toEqual(['id-nativo']);
  });

  it('só a dona do sistema publica novas versões', () => {
    const index = publish(emptyIndex(NOW), template(), 'Maria');
    const next = envelope(template({ version: '1.1.0' }));
    expect(codesOf(next, context({ index, submitter: 'joao' }))).toEqual(['id-de-outra-pessoa']);
    // Logins do GitHub não diferenciam maiúsculas.
    expect(codesOf(next, context({ index, submitter: 'maria' }))).toEqual([]);
  });

  it('exige versão maior que a publicada e sugere a próxima', () => {
    const index = publish(emptyIndex(NOW), template({ version: '1.2.3' }));
    for (const version of ['1.2.3', '1.0.0']) {
      const result = prepareSubmission(envelope(template({ version })), context({ index }));
      expect(result).toMatchObject({
        ok: false,
        error: [{ code: 'versao-nao-e-nova', message: expect.stringContaining('1.2.4') }],
      });
    }
    expect(codesOf(envelope(template({ version: '1.10.0' })), context({ index }))).toEqual([]);
  });
});

describe('addVersion', () => {
  it('cria a entrada com os metadados do sistema', () => {
    const index = publish(emptyIndex('2020-01-01T00:00:00.000Z'), template({ author: 'Maria' }));
    expect(index.updatedAt).toBe(NOW);
    expect(index.templates).toEqual([
      {
        id: 'mini-5e',
        name: 'Mini 5e',
        author: 'Maria',
        license: 'CC-BY-4.0',
        language: 'pt-BR',
        owner: 'maria',
        versions: [{ version: '1.0.0', sha256: HASH, size: 100, publishedAt: NOW }],
      },
    ]);
  });

  it('acumula versões em ordem; os metadados seguem a versão mais recente', () => {
    let index = publish(emptyIndex(NOW), template({ version: '1.0.0', name: 'Antigo' }));
    index = publish(index, template({ version: '2.0.0', name: 'Novo' }));
    // Correção publicada depois para a linha 1.x: não rebaixa o nome nem a ordem.
    index = publish(index, template({ version: '1.0.1', name: 'Antigo corrigido' }));
    const [entry] = index.templates;
    expect(entry?.name).toBe('Novo');
    expect(entry?.versions.map((v) => v.version)).toEqual(['1.0.0', '1.0.1', '2.0.0']);
    expect(entry && latestVersion(entry).version).toBe('2.0.0');
  });

  it('mantém o catálogo ordenado por id e preserva a dona', () => {
    let index = publish(emptyIndex(NOW), template({ id: 'zeta' }), 'ana');
    index = publish(index, template({ id: 'alfa' }), 'bia');
    index = publish(index, template({ id: 'zeta', version: '1.1.0' }), 'ANA');
    expect(index.templates.map((e) => [e.id, e.owner])).toEqual([
      ['alfa', 'bia'],
      ['zeta', 'ana'],
    ]);
  });

  it('o catálogo gerado é lido de volta pelo app', () => {
    const index = publish(emptyIndex(NOW), template({ minAppVersion: '0.1.0' }));
    expect(parseRegistryIndex(serializeIndex(index))).toEqual({ ok: true, value: index });
    expect(index.templates[0]?.versions[0]?.minAppVersion).toBe('0.1.0');
  });
});

describe('leitura pelo app', () => {
  it('recusa catálogo inválido', () => {
    expect(parseRegistryIndex('{}')).toMatchObject({
      ok: false,
      error: [{ code: 'indice-invalido' }],
    });
    expect(parseRegistryIndex('nada')).toMatchObject({
      ok: false,
      error: [{ code: 'json-invalido' }],
    });
  });

  it('lê o arquivo de uma versão como sistema da comunidade', () => {
    const text = serializeTemplateFile(template({ source: 'local' }));
    expect(parseTemplateFile(text, { id: 'mini-5e', version: '1.0.0' })).toMatchObject({
      ok: true,
      value: { id: 'mini-5e', source: 'community' },
    });
  });

  it('recusa um arquivo com outro sistema ou outra versão', () => {
    const text = serializeTemplateFile(template());
    expect(parseTemplateFile(text, { id: 'mini-5e', version: '1.0.1' })).toMatchObject({
      ok: false,
      error: [{ code: 'arquivo-trocado' }],
    });
    expect(parseTemplateFile(text, { id: 'outro', version: '1.0.0' }).ok).toBe(false);
  });
});
