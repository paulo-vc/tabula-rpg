import { z } from 'zod';
import { FORMAT_VERSION } from '../format';
import { err, ok, type Issue, type Result } from '../result';
import { CharacterSheetSchema } from '../sheet/schema';
import { compileTemplate } from '../template/compile';
import { SystemTemplateSchema } from '../template/schema';

/** Tamanho máximo de um arquivo importado (2 MB). */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const envelopeBase = {
  formatVersion: z.literal(FORMAT_VERSION),
  /** Data de exportação em ISO 8601. Informativa. */
  exportedAt: z.iso.datetime(),
};

export const ExportEnvelopeSchema = z.discriminatedUnion('kind', [
  z.object({
    ...envelopeBase,
    kind: z.literal('tabula/template'),
    payload: SystemTemplateSchema,
  }),
  z.object({
    ...envelopeBase,
    kind: z.literal('tabula/sheet'),
    payload: CharacterSheetSchema,
    /** Template da ficha, para que o arquivo seja autocontido. */
    template: SystemTemplateSchema.optional(),
  }),
]);
export type ExportEnvelope = z.infer<typeof ExportEnvelopeSchema>;

const issue = (code: string, message: string, path: Issue['path'] = []): Issue => ({
  code,
  path,
  message,
});

/**
 * Lê um arquivo exportado pelo Tabularium. Todo dado externo entra no sistema por aqui:
 * tamanho, JSON, versão do formato, schema e regras semânticas do template são verificados.
 */
export function parseExport(text: string): Result<ExportEnvelope, Issue[]> {
  if (text.length > MAX_IMPORT_BYTES) {
    return err([issue('arquivo-grande-demais', 'O arquivo excede o tamanho máximo de 2 MB')]);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err([issue('json-invalido', 'O arquivo não é um JSON válido')]);
  }

  const version = (json as { formatVersion?: unknown } | null)?.formatVersion;
  if (typeof version === 'number' && version > FORMAT_VERSION) {
    return err([
      issue(
        'formato-mais-novo',
        'Este arquivo foi criado por uma versão mais nova do Tabularium. Atualize o app.',
      ),
    ]);
  }

  let parsed: ReturnType<typeof ExportEnvelopeSchema.safeParse>;
  try {
    parsed = ExportEnvelopeSchema.safeParse(json);
  } catch (error) {
    // Estruturas aninhadas a ponto de estourar a pilha (arquivo degenerado ou malicioso).
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

  const envelope = parsed.data;
  const template = envelope.kind === 'tabula/template' ? envelope.payload : envelope.template;
  if (template) {
    const compiled = compileTemplate(template);
    const prefix = envelope.kind === 'tabula/template' ? 'payload' : 'template';
    if (!compiled.ok) {
      return err(compiled.error.map((i) => ({ ...i, path: [prefix, ...i.path] })));
    }
  }
  return ok(envelope);
}

/** Serializa um envelope para salvar em arquivo. */
export function serializeExport(envelope: ExportEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}
