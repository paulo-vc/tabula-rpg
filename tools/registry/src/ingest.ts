import {
  MAX_TEMPLATE_BYTES,
  prepareSubmission,
  serializeTemplateFile,
  templatePath,
  type Issue,
  type Result,
  type SystemTemplate,
} from '@tabula/domain';
import { locateFile, parsePublishForm } from './issue-form';
import {
  buildIndex,
  RecordSchema,
  recordPath,
  type RepoState,
  type RepoWrite,
  type TemplateRecord,
} from './repo';

export interface IngestInput {
  /** Corpo da issue de publicação. */
  body: string;
  /** Conta do GitHub que abriu a issue. */
  submitter: string;
  now: string;
  repo: RepoState;
  builtinIds: readonly string[];
  /** Baixa um anexo da issue (texto, até `maxBytes`). */
  download(url: string, maxBytes: number): Promise<string>;
}

export interface Ingested {
  template: SystemTemplate;
  writes: RepoWrite[];
}

const failure = (code: string, message: string): { ok: false; error: Issue[] } => ({
  ok: false,
  error: [{ code, path: [], message }],
});

/**
 * Transforma uma issue de publicação nos arquivos a incluir no repositório, com as
 * mesmas regras que o app aplica ao instalar (e as de posse e versão do catálogo).
 */
export async function ingest(input: IngestInput): Promise<Result<Ingested, Issue[]>> {
  const form = parsePublishForm(input.body);
  const location = locateFile(form.file);
  if (!location) {
    return failure(
      'arquivo-ausente',
      'Não encontrei o arquivo do sistema. Arraste o arquivo `.json` exportado pelo app para o campo "Arquivo do sistema".',
    );
  }

  let text: string;
  if (location.kind === 'texto') {
    text = location.text;
  } else {
    try {
      text = await input.download(location.url, MAX_TEMPLATE_BYTES);
    } catch {
      return failure('download-falhou', 'Não foi possível baixar o arquivo anexado.');
    }
  }

  return publish(text, { ...input, license: form.license, author: form.author });
}

export interface PublishInput {
  submitter: string;
  now: string;
  repo: RepoState;
  builtinIds: readonly string[];
  license?: string | undefined;
  author?: string | undefined;
}

/**
 * Valida um sistema e gera os arquivos a incluir no repositório. Usado pela automação
 * (issue de publicação) e pela moderação (`add`, para incluir um arquivo diretamente).
 */
export function publish(text: string, input: PublishInput): Result<Ingested, Issue[]> {
  const index = buildIndex(input.repo);
  if (!index.ok) {
    return failure('repositorio-invalido', 'O repositório está inconsistente. Avise a moderação.');
  }

  const prepared = prepareSubmission(text, {
    index: index.value,
    submitter: input.submitter,
    builtinIds: input.builtinIds,
    license: input.license,
    author: input.author,
  });
  if (!prepared.ok) return prepared;
  const template = prepared.value;

  const existing = RecordSchema.safeParse(input.repo.get(template.id)?.record);
  const record: TemplateRecord = existing.success
    ? existing.data
    : { owner: input.submitter, versions: {} };
  record.versions[template.version] = { publishedAt: input.now };

  return {
    ok: true,
    value: {
      template,
      writes: [
        {
          path: templatePath(template.id, template.version),
          content: serializeTemplateFile(template),
        },
        { path: recordPath(template.id), content: `${JSON.stringify(record, null, 2)}\n` },
      ],
    },
  };
}

/** Comentário publicado na issue com o resultado da verificação. */
export function report(result: Result<Ingested, Issue[]>): string {
  if (result.ok) {
    const { name, version } = result.value.template;
    return [
      `✅ **${name}** ${version} passou na verificação automática.`,
      '',
      'Um pedido de inclusão foi aberto. Depois da revisão, o sistema aparece em **Explorar comunidade**, dentro do app.',
    ].join('\n');
  }
  const lines = result.error
    .slice(0, 20)
    .map(
      (issue) => `- ${issue.path.length ? `\`${issue.path.join('.')}\`: ` : ''}${issue.message}`,
    );
  if (result.error.length > 20) lines.push(`- … e mais ${result.error.length - 20} problema(s)`);
  return [
    '❌ O sistema não passou na verificação automática:',
    '',
    ...lines,
    '',
    'Corrija e **edite esta issue** (anexando o arquivo novo) para verificar de novo.',
  ].join('\n');
}
