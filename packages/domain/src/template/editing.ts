import type { Issue } from '../result';
import { LIMITS } from '../schema/primitives';
import { parseVersion } from '../version';
import type {
  FieldDef,
  FieldType,
  LayoutNode,
  ListItemFieldDef,
  SectionDisplay,
  SystemTemplate,
} from './schema';

/**
 * Operações do criador visual de sistemas. Todas são puras: recebem o template e devolvem
 * uma cópia alterada. O rascunho pode estar temporariamente inválido (rótulo vazio,
 * fórmula incompleta); quem valida é `compileTemplate`, antes de salvar.
 */

/** Caminho de um nó no layout: índices a partir de `layouts.full`. */
export type NodePath = readonly number[];

export type Columns = 1 | 2 | 3 | 4;

export type ItemFieldType = ListItemFieldDef['type'];

// ---------- Nomes ----------

const stripAccents = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Apelido para fórmulas a partir do rótulo: "Força de Vontade" → "forca_de_vontade". */
export function keyFromLabel(label: string): string {
  const key = stripAccents(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+|_+$/g, '')
    .slice(0, 36)
    .replace(/_+$/, '');
  return key || 'campo';
}

/** Primeiro nome livre: `base`, `base_2`, `base_3`… */
export function uniqueName(base: string, taken: ReadonlySet<string>, separator = '_'): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${separator}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Identificador de sistema a partir do nome: "Meu Sistema!" → "meu-sistema". */
export function templateIdFromName(name: string, taken: ReadonlySet<string>): string {
  const base =
    stripAccents(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'sistema';
  return uniqueName(base, taken, '-');
}

// ---------- Template novo ----------

export function blankTemplate(input: {
  id: string;
  name: string;
  author?: string;
}): SystemTemplate {
  return {
    id: input.id,
    version: '1.0.0',
    name: input.name,
    ...(input.author && { author: input.author }),
    language: 'pt-BR',
    source: 'local',
    fields: [{ id: 'nome', key: 'nome', label: 'Nome', type: 'text' }],
    layouts: {
      full: [
        {
          kind: 'section',
          title: 'Personagem',
          columns: 2,
          children: [{ kind: 'field', fieldId: 'nome' }],
        },
      ],
    },
  };
}

/** Cópia editável de outro sistema (nativo, da comunidade ou local). */
export function copyTemplate(
  template: SystemTemplate,
  input: { id: string; name: string },
): SystemTemplate {
  const copy = structuredCloneJson(template);
  return { ...copy, id: input.id, name: input.name, version: '1.0.0', source: 'local' };
}

const structuredCloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------- Campos ----------

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  number: 'Número',
  text: 'Texto curto',
  longtext: 'Texto longo',
  boolean: 'Caixa de marcar',
  select: 'Escolha',
  dice: 'Dados',
  resource: 'Recurso (atual/máximo)',
  computed: 'Calculado (fórmula)',
  list: 'Lista de itens',
};

export const ITEM_FIELD_TYPES: readonly ItemFieldType[] = [
  'text',
  'number',
  'boolean',
  'select',
  'dice',
  'longtext',
];

/** Campo novo com as propriedades mínimas do tipo. */
export function createField(
  type: FieldType,
  label: string,
  taken: { ids: ReadonlySet<string>; keys: ReadonlySet<string> },
): FieldDef {
  const key = uniqueName(keyFromLabel(label), taken.keys);
  // O ID nasce igual ao apelido (legível no arquivo) e nunca muda depois.
  const id = uniqueName(key, taken.ids);
  return withType({ id, key, label }, type) as FieldDef;
}

/** Item de lista novo. */
export function createItemField(
  type: ItemFieldType,
  label: string,
  siblings: readonly ListItemFieldDef[],
): ListItemFieldDef {
  const key = uniqueName(keyFromLabel(label), new Set(siblings.map((f) => f.key)));
  const id = uniqueName(key, new Set(siblings.map((f) => f.id)));
  return withType({ id, key, label }, type) as ListItemFieldDef;
}

type BaseProps = Pick<FieldDef, 'id' | 'key' | 'label' | 'description' | 'visibility'>;

/** Troca o tipo de um campo mantendo nome, apelido, descrição e visibilidade. */
export function withType(field: BaseProps, type: FieldType): FieldDef {
  const base: BaseProps = {
    id: field.id,
    key: field.key,
    label: field.label,
    ...(field.description !== undefined && { description: field.description }),
    ...(field.visibility !== undefined && { visibility: field.visibility }),
  };
  switch (type) {
    case 'number':
      return { ...base, type, default: 0 };
    case 'select':
      return {
        ...base,
        type,
        options: [
          { value: 'opcao_1', label: 'Opção 1' },
          { value: 'opcao_2', label: 'Opção 2' },
        ],
      };
    case 'resource':
      return { ...base, type, default: 10 };
    case 'computed':
      return { ...base, type, formula: '0' };
    case 'list':
      return {
        ...base,
        type,
        itemFields: [{ id: 'nome', key: 'nome', label: 'Nome', type: 'text' }],
      };
    default:
      return { ...base, type };
  }
}

const allKeys = (template: SystemTemplate) => new Set(template.fields.map((f) => f.key));
const allIds = (template: SystemTemplate) => new Set(template.fields.map((f) => f.id));

/** Adiciona um campo no fim de uma seção (ou no fim da ficha, se `section` for `null`). */
export function addField(
  template: SystemTemplate,
  type: FieldType,
  label: string,
  section: NodePath | null,
): { template: SystemTemplate; fieldId: string } {
  const field = createField(type, label, { ids: allIds(template), keys: allKeys(template) });
  const node: LayoutNode = { kind: 'field', fieldId: field.id };
  const full =
    section === null
      ? [...template.layouts.full, node]
      : updateNode(template.layouts.full, section, (target) =>
          target.kind === 'section' ? { ...target, children: [...target.children, node] } : target,
        );
  return {
    template: {
      ...template,
      fields: [...template.fields, field],
      layouts: { ...template.layouts, full },
    },
    fieldId: field.id,
  };
}

/**
 * Substitui a definição de um campo. Se o apelido mudou (do campo ou de uma coluna de
 * lista), as fórmulas que o usam são reescritas: renomear nunca quebra o sistema.
 */
export function updateField(template: SystemTemplate, next: FieldDef): SystemTemplate {
  const previous = template.fields.find((f) => f.id === next.id);
  if (!previous) return template;
  const renames = renamesBetween(previous, next);
  const fields = template.fields.map((field) => {
    const updated = field.id === next.id ? next : field;
    return renames.reduce((f, [from, to]) => renameInField(f, from, to), updated);
  });
  return { ...template, fields };
}

/** Pares [de, para] de referências que mudaram de nome (`hp`, `inventario.peso`…). */
function renamesBetween(previous: FieldDef, next: FieldDef): [string, string][] {
  const renames: [string, string][] = [];
  if (previous.key !== next.key) renames.push([previous.key, next.key]);
  if (previous.type === 'list' && next.type === 'list') {
    // Depois de renomear a lista, as colunas são procuradas já com o nome novo.
    for (const item of next.itemFields) {
      const before = previous.itemFields.find((old) => old.id === item.id);
      if (before && before.key !== item.key) {
        renames.push([`${next.key}.${before.key}`, `${next.key}.${item.key}`]);
      }
    }
  }
  return renames;
}

function renameInField(field: FieldDef, from: string, to: string): FieldDef {
  if (field.type === 'computed')
    return { ...field, formula: renameReference(field.formula, from, to) };
  if (field.type === 'resource' && field.max !== undefined) {
    return { ...field, max: renameReference(field.max, from, to) };
  }
  return field;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Troca `@de` por `@para` numa fórmula, preservando o resto do texto (espaços, textos
 * entre aspas e outras referências que só começam igual, como `@de_mod`). `de` pode ser
 * uma coluna de lista (`inventario.peso`).
 */
export function renameReference(formula: string, from: string, to: string): string {
  const pattern = new RegExp(`@${escapeRegExp(from)}(?![a-z0-9_])`, 'g');
  // Partes ímpares são textos entre aspas, que não são referências.
  return formula
    .split(/("(?:[^"\\]|\\.)*")/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(pattern, `@${to}`)))
    .join('');
}

/** Cópia de um campo logo abaixo do original, com nome, apelido e ID novos. */
export function duplicateField(
  template: SystemTemplate,
  fieldId: string,
): { template: SystemTemplate; fieldId: string } {
  const original = template.fields.find((f) => f.id === fieldId);
  if (!original) return { template, fieldId };
  const key = uniqueName(original.key, allKeys(template));
  const id = uniqueName(key, allIds(template));
  const copy: FieldDef = {
    ...(JSON.parse(JSON.stringify(original)) as FieldDef),
    id,
    key,
    label: `${original.label} (cópia)`.slice(0, LIMITS.label),
  };
  const path = pathOfField(template.layouts.full, fieldId);
  const node: LayoutNode = { kind: 'field', fieldId: id };
  const full = path
    ? insertAt(template.layouts.full, path.slice(0, -1), (path.at(-1) as number) + 1, node)
    : [...template.layouts.full, node];
  return {
    template: {
      ...template,
      fields: [...template.fields, copy],
      layouts: { ...template.layouts, full },
    },
    fieldId: id,
  };
}

/** Remove o campo, o lugar dele na ficha e no resumo do Mestre. */
export function removeField(template: SystemTemplate, fieldId: string): SystemTemplate {
  const gmSummary = template.layouts.gmSummary?.filter((id) => id !== fieldId);
  return {
    ...template,
    fields: template.fields.filter((f) => f.id !== fieldId),
    layouts: {
      ...template.layouts,
      full: removeFieldNodes(template.layouts.full, fieldId),
      ...(template.layouts.compact && {
        compact: removeFieldNodes(template.layouts.compact, fieldId),
      }),
      ...(gmSummary && { gmSummary }),
    },
  };
}

/** Tira o campo do layout: o nó dele e a referência como campo secundário de outro. */
function removeFieldNodes(nodes: readonly LayoutNode[], fieldId: string): LayoutNode[] {
  return nodes
    .filter((node) => node.kind !== 'field' || node.fieldId !== fieldId)
    .map((node) => {
      if (node.kind === 'section') {
        return { ...node, children: removeFieldNodes(node.children, fieldId) };
      }
      if (node.secondary !== fieldId) return node;
      const { secondary: _, ...rest } = node;
      return rest;
    });
}

/**
 * Mostra `secondary` junto de `fieldId`, pequeno (ex.: o valor do atributo junto do
 * modificador). O campo secundário sai do lugar onde estava. `undefined` desfaz.
 */
export function setFieldSecondary(
  template: SystemTemplate,
  fieldId: string,
  secondary: string | undefined,
): SystemTemplate {
  if (secondary === fieldId) return template;
  const current = pathOfField(template.layouts.full, fieldId);
  if (!current) return template;
  const node = nodeAt(template.layouts.full, current);
  if (node?.kind !== 'field' || node.secondary === secondary) return template;

  let full: LayoutNode[] = [...template.layouts.full];
  const previous = node.secondary;
  if (secondary !== undefined) full = removeFieldNodes(full, secondary);
  const path = pathOfField(full, fieldId);
  if (!path) return template;
  full = updateNode(full, path, (target) => {
    if (target.kind !== 'field') return target;
    const { secondary: _, ...rest } = target;
    return secondary === undefined ? rest : { ...rest, secondary };
  });
  // O secundário anterior volta a aparecer logo depois do campo, sem sumir da ficha.
  if (previous !== undefined) {
    full = insertAt(full, path.slice(0, -1), (path.at(-1) as number) + 1, {
      kind: 'field',
      fieldId: previous,
    });
  }
  return withFull(template, full);
}

/** Campos cujas fórmulas usam o apelido (para avisar antes de excluir). */
export function fieldsReferencing(template: SystemTemplate, key: string): FieldDef[] {
  const pattern = new RegExp(`@${key}(?![a-z0-9_])`);
  return template.fields.filter(
    (field) =>
      (field.type === 'computed' && pattern.test(field.formula)) ||
      (field.type === 'resource' && field.max !== undefined && pattern.test(field.max)),
  );
}

export function setInGmSummary(
  template: SystemTemplate,
  fieldId: string,
  included: boolean,
): SystemTemplate {
  const current = template.layouts.gmSummary ?? [];
  const without = current.filter((id) => id !== fieldId);
  const gmSummary = included ? [...without, fieldId].slice(0, LIMITS.gmSummary) : without;
  return { ...template, layouts: { ...template.layouts, gmSummary } };
}

// ---------- Layout ----------

function updateNode(
  nodes: readonly LayoutNode[],
  path: NodePath,
  change: (node: LayoutNode) => LayoutNode,
): LayoutNode[] {
  const [index, ...rest] = path;
  return nodes.map((node, i) => {
    if (i !== index) return node;
    if (rest.length === 0) return change(node);
    return node.kind === 'section'
      ? { ...node, children: updateNode(node.children, rest, change) }
      : node;
  });
}

export function nodeAt(nodes: readonly LayoutNode[], path: NodePath): LayoutNode | undefined {
  let current: LayoutNode | undefined;
  let level: readonly LayoutNode[] = nodes;
  for (const index of path) {
    current = level[index];
    if (!current) return undefined;
    level = current.kind === 'section' ? current.children : [];
  }
  return current;
}

/** Caminho do nó que posiciona um campo, se ele estiver na ficha. */
export function pathOfField(nodes: readonly LayoutNode[], fieldId: string): number[] | null {
  for (const [index, node] of nodes.entries()) {
    if (node.kind === 'field' && node.fieldId === fieldId) return [index];
    if (node.kind === 'section') {
      const inner = pathOfField(node.children, fieldId);
      if (inner) return [index, ...inner];
    }
  }
  return null;
}

const withFull = (template: SystemTemplate, full: LayoutNode[]): SystemTemplate => ({
  ...template,
  layouts: { ...template.layouts, full },
});

/** Nova seção no fim da ficha (ou dentro de outra seção). */
export function addSection(
  template: SystemTemplate,
  title: string,
  parent: NodePath = [],
): SystemTemplate {
  const section: LayoutNode = { kind: 'section', title, columns: 2, children: [] };
  if (parent.length === 0) return withFull(template, [...template.layouts.full, section]);
  return withFull(
    template,
    updateNode(template.layouts.full, parent, (node) =>
      node.kind === 'section' ? { ...node, children: [...node.children, section] } : node,
    ),
  );
}

export function updateSection(
  template: SystemTemplate,
  path: NodePath,
  change: { title?: string; columns?: Columns; tab?: string; display?: SectionDisplay },
): SystemTemplate {
  return withFull(
    template,
    updateNode(template.layouts.full, path, (node) => {
      if (node.kind !== 'section') return node;
      const next = { ...node, ...change };
      // Valores vazios (aba sem nome, exibição padrão) saem do arquivo.
      if (!next.tab?.trim()) delete next.tab;
      if (next.display === 'padrao') delete next.display;
      return next;
    }),
  );
}

/** Remove uma seção vazia. Seções com campos não são removidas (os campos sumiriam da ficha). */
export function removeSection(template: SystemTemplate, path: NodePath): SystemTemplate {
  const node = nodeAt(template.layouts.full, path);
  if (node?.kind !== 'section' || node.children.length > 0) return template;
  return withFull(template, removeAt(template.layouts.full, path).nodes);
}

function removeAt(
  nodes: readonly LayoutNode[],
  path: NodePath,
): { nodes: LayoutNode[]; removed: LayoutNode | undefined } {
  const [index, ...rest] = path;
  if (rest.length === 0) {
    return { nodes: nodes.filter((_, i) => i !== index), removed: nodes[index as number] };
  }
  let removed: LayoutNode | undefined;
  const updated = nodes.map((node, i) => {
    if (i !== index || node.kind !== 'section') return node;
    const inner = removeAt(node.children, rest);
    removed = inner.removed;
    return { ...node, children: inner.nodes };
  });
  return { nodes: updated, removed };
}

function insertAt(
  nodes: readonly LayoutNode[],
  parent: NodePath,
  index: number,
  node: LayoutNode,
): LayoutNode[] {
  if (parent.length === 0) return [...nodes.slice(0, index), node, ...nodes.slice(index)];
  return updateNode(nodes, parent, (target) =>
    target.kind === 'section'
      ? { ...target, children: insertAt(target.children, [], index, node) }
      : target,
  );
}

/** Sobe (-1) ou desce (+1) um nó entre os irmãos. */
export function moveNode(template: SystemTemplate, path: NodePath, delta: -1 | 1): SystemTemplate {
  const parent = path.slice(0, -1);
  const index = path[path.length - 1] as number;
  const siblings = parent.length === 0 ? template.layouts.full : childrenOf(template, parent);
  const target = index + delta;
  if (!siblings || target < 0 || target >= siblings.length) return template;
  const { nodes, removed } = removeAt(template.layouts.full, path);
  if (!removed) return template;
  return withFull(template, insertAt(nodes, parent, target, removed));
}

/**
 * Leva um nó para a posição `index` dentro de `parent` (arrastar e soltar). Na mesma
 * lista, o nó termina na posição `index` (como `arrayMove`); em outra, entra antes do nó
 * que estava ali. Uma seção não pode ir para dentro de si mesma.
 */
export function moveNodeTo(
  template: SystemTemplate,
  from: NodePath,
  parent: NodePath,
  index: number,
): SystemTemplate {
  const node = nodeAt(template.layouts.full, from);
  const isInside = parent.length >= from.length && from.every((step, i) => parent[i] === step);
  if (!node || isInside) return template;
  if (parent.length > 0 && nodeAt(template.layouts.full, parent)?.kind !== 'section') {
    return template;
  }
  const sameList = from.length === parent.length + 1 && parent.every((step, i) => from[i] === step);
  if (sameList) {
    const { nodes } = removeAt(template.layouts.full, from);
    return withFull(template, insertAt(nodes, parent, index, node));
  }
  // Inserir primeiro mantém `parent` válido; depois corrige o caminho de origem, que
  // anda uma casa se o nó novo entrou antes dele na mesma lista de um ancestral.
  const inserted = insertAt(template.layouts.full, parent, index, node);
  const source = [...from];
  const depth = parent.length;
  if (
    source.length > depth &&
    parent.every((step, i) => source[i] === step) &&
    (source[depth] as number) >= index
  ) {
    source[depth] = (source[depth] as number) + 1;
  }
  return withFull(template, removeAt(inserted, source).nodes);
}

function childrenOf(template: SystemTemplate, path: NodePath): readonly LayoutNode[] | undefined {
  const node = nodeAt(template.layouts.full, path);
  return node?.kind === 'section' ? node.children : undefined;
}

/** Leva um campo para o fim de uma seção. */
export function moveFieldToSection(
  template: SystemTemplate,
  fieldId: string,
  section: NodePath,
): SystemTemplate {
  if (nodeAt(template.layouts.full, section)?.kind !== 'section') return template;
  const from = pathOfField(template.layouts.full, fieldId);
  const node: LayoutNode = (from && nodeAt(template.layouts.full, from)) ?? {
    kind: 'field',
    fieldId,
  };
  // Primeiro acrescenta no fim da seção, depois remove a posição antiga: acrescentar no
  // fim não muda o caminho de nenhum nó existente.
  const appended = updateNode(template.layouts.full, section, (target) =>
    target.kind === 'section' ? { ...target, children: [...target.children, node] } : target,
  );
  return withFull(template, from ? removeAt(appended, from).nodes : appended);
}

/** Largura do campo na seção (`undefined`: automática). */
export function setFieldSpan(
  template: SystemTemplate,
  fieldId: string,
  span: Columns | undefined,
): SystemTemplate {
  const path = pathOfField(template.layouts.full, fieldId);
  if (!path) return template;
  return withFull(
    template,
    updateNode(template.layouts.full, path, (node) => {
      if (node.kind !== 'field') return node;
      const { span: _, ...rest } = node;
      return span === undefined ? rest : { ...rest, span };
    }),
  );
}

// ---------- Versões e problemas ----------

export type VersionBump = 'patch' | 'minor' | 'major';

export function bumpVersion(version: string, bump: VersionBump): string {
  const [major, minor, patch] = parseVersion(version);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** O conteúdo mudou (a versão e a origem não contam). */
export function contentChanged(a: SystemTemplate, b: SystemTemplate): boolean {
  const strip = ({ version: _v, source: _s, ...rest }: SystemTemplate) => JSON.stringify(rest);
  return strip(a) !== strip(b);
}

/**
 * Agrupa os problemas de validação pelo campo a que se referem (pelo ID), para o editor
 * marcar cada campo. Problemas do sistema como um todo ficam em `geral`.
 */
export function issuesByField(
  template: SystemTemplate,
  issues: readonly Issue[],
): { byField: Map<string, Issue[]>; general: Issue[] } {
  const byField = new Map<string, Issue[]>();
  const general: Issue[] = [];
  for (const issue of issues) {
    const [root, index] = issue.path;
    const field =
      root === 'fields' && typeof index === 'number' ? template.fields[index] : undefined;
    if (field) byField.set(field.id, [...(byField.get(field.id) ?? []), issue]);
    else general.push(issue);
  }
  return { byField, general };
}
