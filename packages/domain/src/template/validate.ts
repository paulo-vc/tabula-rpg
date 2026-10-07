import { err, type Issue, type Result } from '../result';
import { compileTemplate, type CompiledTemplate } from './compile';
import { SystemTemplateSchema } from './schema';

/**
 * Validação completa de um template vindo de fora ou do editor: formato (schema) e regras
 * semânticas (`compileTemplate`). Nunca lança exceção.
 */
export function validateTemplate(json: unknown): Result<CompiledTemplate, Issue[]> {
  let parsed: ReturnType<typeof SystemTemplateSchema.safeParse>;
  try {
    parsed = SystemTemplateSchema.safeParse(json);
  } catch (error) {
    // Estruturas aninhadas a ponto de estourar a pilha (arquivo degenerado ou malicioso).
    if (error instanceof RangeError) {
      return err([
        { code: 'estrutura-invalida', path: [], message: 'O arquivo tem uma estrutura inválida' },
      ]);
    }
    throw error;
  }
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((zodIssue) => ({
        code: 'schema-invalido',
        path: zodIssue.path.filter((p): p is string | number => typeof p !== 'symbol'),
        message: zodIssue.message,
      })),
    );
  }
  return compileTemplate(parsed.data);
}
