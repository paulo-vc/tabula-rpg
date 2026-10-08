import type { Issue, SystemTemplate } from '@tabula/domain';

/** Nome amigável das propriedades que aparecem nos caminhos dos problemas. */
const PROPERTY_NAMES: Record<string, string> = {
  label: 'nome',
  key: 'apelido',
  options: 'opções',
  itemFields: 'colunas',
  formula: 'fórmula',
  max: 'máximo',
  default: 'valor inicial',
  name: 'nome do sistema',
  version: 'versão',
  id: 'identificador',
  license: 'licença',
  author: 'autor',
  title: 'título da seção',
  tags: 'etiquetas',
  checkDice: 'dado dos testes',
};

/**
 * Texto de um problema de validação para o editor: "Força › nome: Obrigatório".
 * Mensagens de formato (schema) não dizem onde estão; as das regras semânticas já dizem.
 */
export function describeIssue(template: SystemTemplate, issue: Issue): string {
  if (issue.code !== 'schema-invalido') return issue.message;
  const parts: string[] = [];
  const [root, index, ...rest] = issue.path;
  if (root === 'fields' && typeof index === 'number') {
    parts.push(template.fields[index]?.label || `Campo ${index + 1}`);
    const [sub, subIndex, property] = rest;
    if (sub === 'options' && typeof subIndex === 'number') parts.push(`opção ${subIndex + 1}`);
    if (sub === 'itemFields' && typeof subIndex === 'number') parts.push(`coluna ${subIndex + 1}`);
    const name = PROPERTY_NAMES[String(typeof subIndex === 'number' ? property : sub)];
    if (name) parts.push(name);
  } else if (root === 'layouts') {
    const name = PROPERTY_NAMES[String(issue.path.at(-1))];
    parts.push(name ? `Seção › ${name}` : 'Layout');
  } else if (typeof root === 'string') {
    parts.push(PROPERTY_NAMES[root] ?? root);
  }
  return `${parts.join(' › ')}: ${issue.message}`;
}
