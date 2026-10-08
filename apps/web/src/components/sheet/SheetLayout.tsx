import type {
  CompiledTemplate,
  DerivedValues,
  FieldDef,
  FieldValue,
  LayoutNode,
  SheetValues,
} from '@tabula/domain';
import { EyeOffIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldLine, SecondaryValue, StatTile, type CompactFieldProps } from './compact';
import { FieldControl } from './fields';

type Columns = 1 | 2 | 3 | 4;
type SectionNode = Extract<LayoutNode, { kind: 'section' }>;

// Classes literais (o Tailwind só gera classes que aparecem inteiras no código-fonte).
// Telas pequenas usam menos colunas que o template define.
const GRID: Record<Columns, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
};

/** Blocos compactos cabem mais por linha, inclusive no celular. */
const TILE_GRID: Record<Columns, string> = {
  1: 'grid-cols-2 sm:grid-cols-3',
  2: 'grid-cols-2 sm:grid-cols-4',
  3: 'grid-cols-3 sm:grid-cols-6',
  4: 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6',
};

/** Colunas efetivas por largura de tela: [base, sm, lg]. */
const EFFECTIVE: Record<Columns, [number, number, number]> = {
  1: [1, 1, 1],
  2: [1, 2, 2],
  3: [1, 2, 3],
  4: [2, 3, 4],
};
const SPAN = [
  ['col-span-1', 'col-span-2', 'col-span-3', 'col-span-4'],
  ['sm:col-span-1', 'sm:col-span-2', 'sm:col-span-3', 'sm:col-span-4'],
  ['lg:col-span-1', 'lg:col-span-2', 'lg:col-span-3', 'lg:col-span-4'],
] as const;

/** Ocupa `span` colunas sem nunca passar do número de colunas da tela (evita colunas extras). */
function spanClass(columns: Columns, span: number): string {
  return EFFECTIVE[columns]
    .map((available, breakpoint) => SPAN[breakpoint]?.[Math.min(span, available) - 1])
    .join(' ');
}

const layoutFieldIds = (nodes: readonly LayoutNode[]): string[] =>
  nodes.flatMap((node) =>
    node.kind === 'field'
      ? node.secondary === undefined
        ? [node.fieldId]
        : [node.fieldId, node.secondary]
      : layoutFieldIds(node.children),
  );

const DEFAULT_TAB = 'Ficha';

/**
 * Agrupa as seções de primeiro nível em abas. Uma seção sem aba fica na aba da anterior
 * (ou na primeira, "Ficha"). Sistemas sem abas viram uma página só, como antes.
 */
export function groupTabs(nodes: readonly LayoutNode[]): { name: string; nodes: LayoutNode[] }[] {
  const hasTabs = nodes.some((node) => node.kind === 'section' && node.tab);
  if (!hasTabs) return [{ name: DEFAULT_TAB, nodes: [...nodes] }];
  const groups: { name: string; nodes: LayoutNode[] }[] = [];
  let current = DEFAULT_TAB;
  for (const node of nodes) {
    if (node.kind === 'section' && node.tab) current = node.tab;
    let group = groups.find((g) => g.name === current);
    if (!group) {
      group = { name: current, nodes: [] };
      groups.push(group);
    }
    group.nodes.push(node);
  }
  return groups;
}

export interface SheetLayoutProps {
  compiled: CompiledTemplate;
  values: SheetValues;
  derived: DerivedValues;
  onChange: (fieldId: string, value: FieldValue) => void;
  newItemId: () => string;
  /** Campos que não aparecem (ex.: os secretos, na ficha do jogador). */
  hiddenFieldIds?: ReadonlySet<string> | undefined;
  /** Campos destacados como "só o Mestre vê" (na visão do Mestre). */
  secretFieldIds?: ReadonlySet<string> | undefined;
}

export function SheetLayout({
  compiled,
  values,
  derived,
  onChange,
  newItemId,
  hiddenFieldIds,
  secretFieldIds,
}: SheetLayoutProps) {
  const base = useId();
  const [selected, setSelected] = useState(0);

  const visible = (fieldId: string | undefined): FieldDef | undefined => {
    if (fieldId === undefined || hiddenFieldIds?.has(fieldId)) return undefined;
    return compiled.fieldsById.get(fieldId);
  };
  const propsOf = (field: FieldDef): CompactFieldProps => ({
    field,
    value: values[field.id],
    derived:
      field.type === 'computed'
        ? derived.computed[field.id]
        : field.type === 'resource'
          ? derived.resourceMax[field.id]
          : undefined,
    onChange: (value) => onChange(field.id, value),
    newItemId,
  });

  /** Seção em blocos compactos (ex.: atributos). */
  const renderTiles = (section: SectionNode) => (
    <div className={cn('grid gap-2', TILE_GRID[section.columns])}>
      {section.children.map((node, index) => {
        if (node.kind === 'section')
          return (
            <div key={index} className="col-span-full">
              {renderSection(node, 1)}
            </div>
          );
        const field = visible(node.fieldId);
        if (!field) return null;
        const secondary = visible(node.secondary);
        return (
          <StatTile
            key={field.id}
            main={propsOf(field)}
            secondary={secondary ? propsOf(secondary) : undefined}
          />
        );
      })}
    </div>
  );

  /** Seção em linhas: cada `columns` campos formam uma linha (ex.: uma perícia). */
  const renderLines = (section: SectionNode) => {
    const rows: CompactFieldProps[][] = [];
    const nested: SectionNode[] = [];
    let row: CompactFieldProps[] = [];
    for (const node of section.children) {
      if (node.kind === 'section') {
        nested.push(node);
        continue;
      }
      const field = visible(node.fieldId);
      if (field) row.push(propsOf(field));
      if (row.length === section.columns) {
        rows.push(row);
        row = [];
      }
    }
    if (row.length > 0) rows.push(row);
    return (
      <div className="space-y-3">
        <div className="sm:columns-2 sm:gap-6">
          {rows.map((cells) => (
            <div key={cells.map((c) => c.field.id).join('-')} className="break-inside-avoid">
              <FieldLine cells={cells} />
            </div>
          ))}
        </div>
        {nested.map((node, index) => (
          <div key={index}>{renderSection(node, 1)}</div>
        ))}
      </div>
    );
  };

  const renderGrid = (nodes: readonly LayoutNode[], columns: Columns, depth: number) => (
    <div className={cn('grid gap-x-4 gap-y-3', GRID[columns])}>
      {nodes.map((node, index) => {
        if (node.kind === 'section') {
          return (
            <div key={index} className="col-span-full">
              {renderSection(node, depth + 1)}
            </div>
          );
        }
        const field = visible(node.fieldId);
        if (!field) return null;
        const secret = secretFieldIds?.has(field.id) ?? false;
        const isWide = field.type === 'list' || field.type === 'longtext';
        const span = node.span ?? (isWide ? columns : 1);
        const secondary = visible(node.secondary);
        return (
          <div
            key={field.id}
            className={cn(
              'min-w-0',
              spanClass(columns, span),
              secret && 'rounded-md border border-dashed border-violet-500/50 p-2',
            )}
          >
            {secret && (
              <p className="mb-1 flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400">
                <EyeOffIcon className="size-3" /> Só o Mestre vê
              </p>
            )}
            <FieldControl {...propsOf(field)} />
            {secondary && (
              <div className="mt-1 flex items-center gap-2">
                <span className="text-muted-foreground text-xs">{secondary.label}</span>
                <SecondaryValue {...propsOf(secondary)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  function renderSection(section: SectionNode, depth: number) {
    const content =
      section.display === 'compacto'
        ? renderTiles(section)
        : section.display === 'linhas'
          ? renderLines(section)
          : renderGrid(section.children, section.columns, depth);
    if (depth === 0) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{section.title}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>{content}</CardContent>
        </Card>
      );
    }
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{section.title}</h3>
        {content}
      </section>
    );
  }

  const { full } = compiled.template.layouts;
  // Campos que o template não posicionou no layout continuam acessíveis.
  const shown = new Set(layoutFieldIds(full));
  const others = compiled.template.fields.filter(
    (field) => !shown.has(field.id) && !hiddenFieldIds?.has(field.id),
  );
  const tabs = groupTabs(full);
  if (others.length > 0) {
    tabs.at(-1)?.nodes.push({
      kind: 'section',
      title: 'Outros campos',
      columns: 2,
      children: others.map((field) => ({ kind: 'field', fieldId: field.id })),
    });
  }
  const active = Math.min(selected, tabs.length - 1);

  const renderTop = (nodes: readonly LayoutNode[]) =>
    nodes.map((node, index) =>
      node.kind === 'section' ? (
        <div key={`${node.title}-${index}`}>{renderSection(node, 0)}</div>
      ) : (
        <div key={node.fieldId}>{renderGrid([node], 1, 0)}</div>
      ),
    );

  if (tabs.length === 1) {
    return <div className="grid gap-4">{renderTop(tabs[0]?.nodes ?? [])}</div>;
  }

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Partes da ficha"
        className="flex gap-1 overflow-x-auto overflow-y-hidden border-b"
        onKeyDown={(event) => {
          // Setas trocam de aba (padrão de abas acessíveis).
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
          const next = (active + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          setSelected(next);
          document.getElementById(`${base}-aba-${next}`)?.focus();
        }}
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.name}
            id={`${base}-aba-${index}`}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-controls={`${base}-painel`}
            tabIndex={index === active ? 0 : -1}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
              index === active
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
            onClick={() => setSelected(index)}
          >
            {tab.name}
          </button>
        ))}
      </div>
      <div
        id={`${base}-painel`}
        role="tabpanel"
        aria-labelledby={`${base}-aba-${active}`}
        className="grid gap-4"
      >
        {renderTop(tabs[active]?.nodes ?? [])}
      </div>
    </div>
  );
}
