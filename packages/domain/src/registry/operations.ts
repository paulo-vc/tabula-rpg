import { err, ok, type Issue, type Result } from '../result';
import { compileTemplate } from '../template/compile';
import { SystemTemplateSchema, type SystemTemplate } from '../template/schema';
import { compareVersions } from '../version';
import {
  latestVersion,
  MAX_INDEX_BYTES,
  MAX_TEMPLATE_BYTES,
  RegistryIndexSchema,
  type RegistryEntry,
  type RegistryIndex,
  type RegistryVersion,
} from './schema';

const issue = (code: string, message: string, path: Issue['path'] = []): Issue => ({
  code,
  path,
  message,
});

function parseJson(text: string, maxBytes: number): Result<unknown, Issue[]> {
  // Comprimento em UTF-16 ≤ bytes em UTF-8: um teste barato que já barra o exagero.
  if (text.length > maxBytes) {
    return err([issue('arquivo-grande-demais', `O arquivo excede ${maxBytes / 1024} KB`)]);
  }
  try {
    return ok(JSON.parse(text));
  } catch {
    return err([issue('json-invalido', 'O arquivo não é um JSON válido')]);
  }
}

/** Schema e regras semânticas (fórmulas, layout) de um template vindo de fora. */
function validateTemplate(json: unknown): Result<SystemTemplate, Issue[]> {
  let parsed: ReturnType<typeof SystemTemplateSchema.safeParse>;
  try {
    parsed = SystemTemplateSchema.safeParse(json);
  } catch (error) {
    if (error instanceof RangeError) {
      return err([issue('estrutura-invalida', 'O arquivo tem uma estrutura inválida')]);
    }
    throw error;
  }
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((zodIssue) =>
        issue(
          'schema-invalido',
          zodIssue.message,
          zodIssue.path.filter((p): p is string | number => typeof p !== 'symbol'),
        ),
      ),
    );
  }
  const compiled = compileTemplate(parsed.data);
  return compiled.ok ? ok(parsed.data) : err(compiled.error);
}

/** Lê o catálogo baixado do repositório. */
export function parseRegistryIndex(text: string): Result<RegistryIndex, Issue[]> {
  const json = parseJson(text, MAX_INDEX_BYTES);
  if (!json.ok) return json;
  const parsed = RegistryIndexSchema.safeParse(json.value);
  if (!parsed.success) {
    return err([issue('indice-invalido', 'O catálogo da comunidade está em um formato inválido')]);
  }
  return ok(parsed.data);
}

/**
 * Lê o arquivo de uma versão publicada. Confere que é mesmo o sistema e a versão
 * pedidos: um arquivo trocado no repositório não instala outra coisa no lugar.
 */
export function parseTemplateFile(
  text: string,
  expected: { id: string; version: string },
): Result<SystemTemplate, Issue[]> {
  const json = parseJson(text, MAX_TEMPLATE_BYTES);
  if (!json.ok) return json;
  const template = validateTemplate(json.value);
  if (!template.ok) return template;
  if (template.value.id !== expected.id || template.value.version !== expected.version) {
    return err([
      issue(
        'arquivo-trocado',
        `Esperava ${expected.id}@${expected.version}, mas o arquivo contém ${template.value.id}@${template.value.version}`,
      ),
    ]);
  }
  return ok({ ...template.value, source: 'community' });
}

/** Arquivo gravado no repositório: o template puro, legível e com diffs estáveis. */
export const serializeTemplateFile = (template: SystemTemplate) =>
  `${JSON.stringify(template, null, 2)}\n`;

export const serializeIndex = (index: RegistryIndex) => `${JSON.stringify(index, null, 2)}\n`;

export interface SubmissionContext {
  index: RegistryIndex;
  /** Conta do GitHub de quem pediu a publicação. */
  submitter: string;
  /** IDs dos sistemas que já vêm com o app: não podem ser publicados por terceiros. */
  builtinIds: readonly string[];
  /** Respostas do formulário de publicação. Prevalecem sobre as do arquivo. */
  license?: string | undefined;
  author?: string | undefined;
}

/**
 * Valida um pedido de publicação: o arquivo exportado pelo app (ou o template puro),
 * completado com as respostas do formulário. Devolve o template exatamente como será
 * publicado.
 */
export function prepareSubmission(
  text: string,
  context: SubmissionContext,
): Result<SystemTemplate, Issue[]> {
  const json = parseJson(text, MAX_TEMPLATE_BYTES);
  if (!json.ok) return json;

  let payload: unknown = json.value;
  const kind = (payload as { kind?: unknown } | null)?.kind;
  if (kind === 'tabula/sheet') {
    return err([
      issue(
        'ficha-em-vez-de-sistema',
        'Este arquivo é uma ficha. Exporte o sistema na tela "Sistemas" e envie esse arquivo.',
      ),
    ]);
  }
  if (kind === 'tabula/template') payload = (payload as { payload?: unknown }).payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return err([issue('schema-invalido', 'O arquivo não contém um sistema do Tabula')]);
  }

  const fromFile = payload as { license?: unknown; author?: unknown };
  const candidate = {
    ...payload,
    source: 'community',
    license: context.license?.trim() || fromFile.license,
    author: context.author?.trim() || fromFile.author || context.submitter,
  };
  const validated = validateTemplate(candidate);
  if (!validated.ok) return validated;
  const template = validated.value;

  const problems: Issue[] = [];
  if (!template.license) {
    problems.push(issue('licenca-ausente', 'Informe a licença do conteúdo', ['license']));
  }
  if (context.builtinIds.includes(template.id)) {
    problems.push(
      issue('id-nativo', `"${template.id}" já vem com o app. Use outro id para o seu sistema.`, [
        'id',
      ]),
    );
  }
  const existing = context.index.templates.find((entry) => entry.id === template.id);
  if (existing) {
    if (existing.owner.toLowerCase() !== context.submitter.toLowerCase()) {
      problems.push(
        issue(
          'id-de-outra-pessoa',
          `O id "${template.id}" já pertence a @${existing.owner}. Use outro id para o seu sistema.`,
          ['id'],
        ),
      );
    } else {
      const latest = latestVersion(existing).version;
      if (compareVersions(template.version, latest) <= 0) {
        problems.push(
          issue(
            'versao-nao-e-nova',
            `A versão publicada mais recente é ${latest}. Aumente a versão (ex.: ${nextPatch(latest)}).`,
            ['version'],
          ),
        );
      }
    }
  }
  return problems.length > 0 ? err(problems) : ok(template);
}

function nextPatch(version: string): string {
  const [major, minor, patch] = version.split('.').map(Number) as [number, number, number];
  return `${major}.${minor}.${patch + 1}`;
}

export interface PublishedFile {
  sha256: string;
  size: number;
  publishedAt: string;
  owner: string;
}

/**
 * Registra uma versão no catálogo (já validada por `prepareSubmission`). Os metadados
 * exibidos na busca acompanham a versão mais recente.
 */
export function addVersion(
  index: RegistryIndex,
  template: SystemTemplate,
  file: PublishedFile,
): RegistryIndex {
  const version: RegistryVersion = {
    version: template.version,
    sha256: file.sha256,
    size: file.size,
    publishedAt: file.publishedAt,
    ...(template.minAppVersion && { minAppVersion: template.minAppVersion }),
  };
  const existing = index.templates.find((entry) => entry.id === template.id);
  const versions = [
    ...(existing?.versions.filter((v) => v.version !== template.version) ?? []),
    version,
  ].sort((a, b) => compareVersions(a.version, b.version));

  const isLatest =
    !existing || compareVersions(template.version, latestVersion(existing).version) > 0;
  const metadata: Omit<RegistryEntry, 'versions'> =
    existing && !isLatest
      ? existing
      : {
          id: template.id,
          name: template.name,
          ...(template.description && { description: template.description }),
          author: template.author ?? file.owner,
          license: template.license ?? '',
          ...(template.language && { language: template.language }),
          ...(template.tags && { tags: template.tags }),
          owner: existing?.owner ?? file.owner,
        };
  const entry: RegistryEntry = { ...metadata, versions };

  return {
    ...index,
    updatedAt: file.publishedAt,
    templates: [...index.templates.filter((e) => e.id !== template.id), entry].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  };
}
