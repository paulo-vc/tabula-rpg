import type {
  CompiledTemplate,
  DerivedValues,
  FieldValue,
  LayoutNode,
  SheetValues,
} from '@tabula/domain';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldControl } from './fields';

type Columns = 1 | 2 | 3 | 4;

// Classes literais (o Tailwind só gera classes que aparecem inteiras no código-fonte).
// Telas pequenas usam menos colunas que o template define.
const GRID: Record<Columns, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
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
  nodes.flatMap((node) => (node.kind === 'field' ? [node.fieldId] : layoutFieldIds(node.children)));

export interface SheetLayoutProps {
  compiled: CompiledTemplate;
  values: SheetValues;
  derived: DerivedValues;
  onChange: (fieldId: string, value: FieldValue) => void;
  newItemId: () => string;
}

export function SheetLayout({ compiled, values, derived, onChange, newItemId }: SheetLayoutProps) {
  const renderNodes = (nodes: readonly LayoutNode[], columns: Columns, depth: number) =>
    nodes.map((node, index) => {
      if (node.kind === 'section') {
        const content = (
          <div className={cn('grid gap-x-4 gap-y-3', GRID[node.columns])}>
            {renderNodes(node.children, node.columns, depth + 1)}
          </div>
        );
        if (depth === 0) {
          return (
            <Card key={index} className="col-span-full">
              <CardHeader>
                <CardTitle>
                  <h2>{node.title}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>{content}</CardContent>
            </Card>
          );
        }
        return (
          <section key={index} className="col-span-full space-y-2">
            <h3 className="text-sm font-semibold">{node.title}</h3>
            {content}
          </section>
        );
      }

      const field = compiled.fieldsById.get(node.fieldId);
      if (!field) return null;
      const isWide = field.type === 'list' || field.type === 'longtext';
      const span = node.span ?? (isWide ? columns : 1);
      const derivedValue =
        field.type === 'computed'
          ? derived.computed[field.id]
          : field.type === 'resource'
            ? derived.resourceMax[field.id]
            : undefined;
      return (
        <div
          key={field.id}
          className={cn('min-w-0', depth === 0 ? 'col-span-full' : spanClass(columns, span))}
        >
          <FieldControl
            field={field}
            value={values[field.id]}
            derived={derivedValue}
            onChange={(value) => onChange(field.id, value)}
            newItemId={newItemId}
          />
        </div>
      );
    });

  const { full } = compiled.template.layouts;
  // Campos que o template não posicionou no layout continuam acessíveis.
  const shown = new Set(layoutFieldIds(full));
  const others = compiled.template.fields.filter((field) => !shown.has(field.id));
  const nodes: LayoutNode[] =
    others.length === 0
      ? full
      : [
          ...full,
          {
            kind: 'section',
            title: 'Outros campos',
            columns: 2,
            children: others.map((field) => ({ kind: 'field', fieldId: field.id })),
          },
        ];

  return <div className="grid gap-4">{renderNodes(nodes, 1, 0)}</div>;
}
