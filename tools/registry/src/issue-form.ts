/**
 * Leitura do formulário de publicação (`.github/ISSUE_TEMPLATE/publicar.yml`). O GitHub
 * transforma cada campo num título `### Rótulo` seguido da resposta.
 */

export const FORM_LABELS = {
  file: 'Arquivo do sistema',
  license: 'Licença',
  author: 'Autor',
} as const;

/** Opção do formulário que mantém a licença declarada dentro do arquivo. */
export const LICENSE_FROM_FILE = 'A que está no arquivo';

const NO_RESPONSE = '_No response_';

export interface PublishForm {
  file: string;
  license: string | undefined;
  author: string | undefined;
}

/** Seções do corpo da issue, por título. */
export function parseSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = body.replace(/\r\n/g, '\n').split(/^### +(.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const value = (parts[i + 1] ?? '').trim();
    sections.set((parts[i] as string).trim(), value === NO_RESPONSE ? '' : value);
  }
  return sections;
}

export function parsePublishForm(body: string): PublishForm {
  const sections = parseSections(body);
  const optional = (label: string) => sections.get(label) || undefined;
  const license = optional(FORM_LABELS.license);
  return {
    file: sections.get(FORM_LABELS.file) ?? '',
    license: license === LICENSE_FROM_FILE ? undefined : license,
    author: optional(FORM_LABELS.author),
  };
}

/** Anexo enviado ao GitHub (arrastar o arquivo para o campo gera este link). */
const ATTACHMENT =
  /https:\/\/github\.com\/user-attachments\/files\/\d+\/[A-Za-z0-9._%()-]+\.json\b/;

export type FileLocation = { kind: 'anexo'; url: string } | { kind: 'texto'; text: string };

/**
 * Onde está o sistema: um anexo `.json` (o caminho normal) ou o JSON colado no campo,
 * com ou sem bloco de código.
 */
export function locateFile(field: string): FileLocation | null {
  const attachment = ATTACHMENT.exec(field);
  if (attachment) return { kind: 'anexo', url: attachment[0] };
  const fenced = /```[a-z]*\n([\s\S]*?)\n```/.exec(field);
  const text = (fenced ? fenced[1] : field)?.trim() ?? '';
  return text.startsWith('{') ? { kind: 'texto', text } : null;
}
