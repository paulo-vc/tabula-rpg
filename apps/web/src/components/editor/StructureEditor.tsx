import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  addField,
  addSection,
  duplicateField,
  FIELD_TYPE_LABELS,
  fieldsReferencing,
  moveFieldToSection,
  moveNode,
  moveNodeTo,
  nodeAt,
  pathOfField,
  removeField,
  removeSection,
  updateSection,
  type Columns,
  type FieldDef,
  type FieldType,
  type Issue,
  type LayoutNode,
  type NodePath,
  type SystemTemplate,
} from '@tabula/domain';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleAlertIcon,
  CopyIcon,
  EllipsisIcon,
  EyeOffIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { ApplyChange } from './use-template-editor';

type Apply = ApplyChange;

const TYPE_HINTS: Record<FieldType, string> = {
  number: 'Atributos, nível, deslocamento…',
  text: 'Nome, classe, raça…',
  longtext: 'História, anotações…',
  boolean: 'Proficiência, inspiração…',
  select: 'Classe, tamanho, condições…',
  dice: 'Dado de vida, dano…',
  resource: 'Vida, mana, sanidade…',
  computed: 'Modificadores, totais, CA…',
  list: 'Inventário, magias, ataques…',
};

const fieldsIn = (nodes: readonly LayoutNode[]): string[] =>
  nodes.flatMap((n) => (n.kind === 'field' ? [n.fieldId] : fieldsIn(n.children)));

/** Seções do layout, com caminho, para os menus "mover para". */
function sectionsOf(nodes: readonly LayoutNode[], prefix: number[] = []) {
  return nodes.flatMap((node, index): { path: number[]; title: string }[] =>
    node.kind === 'section'
      ? [
          { path: [...prefix, index], title: node.title || 'Seção sem título' },
          ...sectionsOf(node.children, [...prefix, index]),
        ]
      : [],
  );
}

// ---------- Arrastar e soltar ----------

/**
 * IDs dos itens arrastáveis: `campo:<id>` (campo), `secao:<caminho>` (seção, pela alça) e
 * `dentro:<caminho>` (área de soltar no fim de uma seção). Durante o arrasto o template
 * não muda, então caminhos servem de ID.
 */
const fieldDragId = (fieldId: string) => `campo:${fieldId}`;
const sectionDragId = (path: NodePath) => `secao:${path.join('.')}`;
const insideDropId = (path: NodePath) => `dentro:${path.join('.')}`;

type DragTarget = { kind: 'campo'; fieldId: string } | { kind: 'secao' | 'dentro'; path: number[] };

function parseDragId(id: string | number): DragTarget | null {
  const [kind, rest = ''] = String(id).split(/:(.*)/s);
  if (kind === 'campo') return { kind, fieldId: rest };
  if (kind === 'secao' || kind === 'dentro') {
    return { kind, path: rest === '' ? [] : rest.split('.').map(Number) };
  }
  return null;
}

/**
 * Campos caem sobre outros campos ou no fim de uma seção; seções só trocam de lugar
 * entre si. Com o ponteiro, vale o que está sob ele; com o teclado, o mais próximo.
 */
const collision: CollisionDetection = (args) => {
  const draggingSection = String(args.active.id).startsWith('secao:');
  const allowed = args.droppableContainers.filter((container) => {
    const id = String(container.id);
    return draggingSection ? id.startsWith('secao:') : !id.startsWith('secao:');
  });
  const scoped = { ...args, droppableContainers: allowed };
  const underPointer = pointerWithin(scoped);
  if (underPointer.length > 0) {
    // Um campo sob o ponteiro tem prioridade sobre a seção que o contém.
    const field = underPointer.find((c) => String(c.id).startsWith('campo:'));
    return field ? [field] : underPointer;
  }
  return closestCorners(scoped);
};

/** Aplica o resultado de um arrasto ao template. */
export function applyDrop(
  template: SystemTemplate,
  activeId: string,
  overId: string,
): SystemTemplate {
  const active = parseDragId(activeId);
  const over = parseDragId(overId);
  if (!active || !over || activeId === overId) return template;
  const full = template.layouts.full;

  if (active.kind === 'secao') {
    if (over.kind !== 'secao' || over.path.length !== active.path.length) return template;
    return moveNodeTo(template, active.path, over.path.slice(0, -1), over.path.at(-1) as number);
  }
  if (active.kind !== 'campo') return template;

  // Campo fora da ficha: entra primeiro numa seção qualquer, depois vai para o lugar certo.
  let current = template;
  let from = pathOfField(full, active.fieldId);
  if (!from) {
    const section =
      over.kind === 'campo' ? pathOfField(full, over.fieldId)?.slice(0, -1) : over.path;
    if (!section || section.length === 0) return template;
    current = moveFieldToSection(current, active.fieldId, section);
    from = pathOfField(current.layouts.full, active.fieldId);
    if (!from) return template;
  }

  if (over.kind === 'campo') {
    const target = pathOfField(current.layouts.full, over.fieldId);
    if (!target) return current;
    return moveNodeTo(current, from, target.slice(0, -1), target.at(-1) as number);
  }
  // Soltar numa seção (área do fim ou cabeçalho): vai para o fim dela.
  const section = nodeAt(current.layouts.full, over.path);
  if (section?.kind !== 'section') return current;
  const sameSection =
    from.length === over.path.length + 1 && over.path.every((step, i) => from[i] === step);
  const end = sameSection ? section.children.length - 1 : section.children.length;
  return moveNodeTo(current, from, over.path, end);
}

// ---------- Estrutura ----------

export function StructureEditor({
  template,
  issues,
  apply,
  onEditField,
}: {
  template: SystemTemplate;
  issues: Map<string, Issue[]>;
  apply: Apply;
  onEditField: (fieldId: string) => void;
}) {
  const [adding, setAdding] = useState<NodePath | null>(null);
  const [toDelete, setToDelete] = useState<FieldDef | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const fieldsById = new Map(template.fields.map((f) => [f.id, f]));
  const sections = sectionsOf(template.layouts.full);
  const placed = new Set(fieldsIn(template.layouts.full));
  const unplaced = template.fields.filter((f) => !placed.has(f.id));

  const sensors = useSensors(
    // Uma pequena distância antes de arrastar mantém os cliques funcionando.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // No toque, segurar um instante: deslizar o dedo continua rolando a página.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (event: DragStartEvent) => setDragging(String(event.active.id));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (over) apply((t) => applyDrop(t, String(active.id), String(over.id)));
  };

  const rowFor = (field: FieldDef, path: NodePath | null, siblings: number) => (
    <FieldRow
      key={field.id}
      field={field}
      path={path}
      siblings={siblings}
      issues={issues.get(field.id)}
      sections={sections}
      apply={apply}
      onEdit={() => onEditField(field.id)}
      onDelete={() => setToDelete(field)}
      onDuplicate={() => {
        const result = duplicateField(template, field.id);
        apply(() => result.template);
        onEditField(result.fieldId);
      }}
    />
  );

  const renderNodes = (nodes: readonly LayoutNode[], prefix: number[]) => (
    <SortableContext
      items={nodes.map((node, index) =>
        node.kind === 'field' ? fieldDragId(node.fieldId) : sectionDragId([...prefix, index]),
      )}
      strategy={verticalListSortingStrategy}
    >
      {nodes.map((node, index) => {
        const path = [...prefix, index];
        if (node.kind === 'field') {
          const field = fieldsById.get(node.fieldId);
          return field ? rowFor(field, path, nodes.length) : null;
        }
        return (
          <SectionCard
            key={`s${path.join('.')}`}
            node={node}
            path={path}
            isFirst={index === 0}
            isLast={index === nodes.length - 1}
            apply={apply}
            onAddField={() => setAdding(path)}
          >
            {renderNodes(node.children, path)}
          </SectionCard>
        );
      })}
    </SortableContext>
  );

  const referencing = toDelete ? fieldsReferencing(template, toDelete.key) : [];
  const draggingTarget = dragging ? parseDragId(dragging) : null;
  const draggingLabel =
    draggingTarget?.kind === 'campo'
      ? fieldsById.get(draggingTarget.fieldId)?.label
      : draggingTarget?.kind === 'secao'
        ? (() => {
            const node = nodeAt(template.layouts.full, draggingTarget.path);
            return node?.kind === 'section' ? node.title : undefined;
          })()
        : undefined;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        Arraste pela alça <GripVerticalIcon className="inline size-3.5" /> para reorganizar (no
        celular, segure um instante antes de arrastar).
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'Para mover, pressione espaço ou Enter, use as setas e pressione espaço de novo para soltar. Esc cancela.',
          },
        }}
      >
        <ul className="space-y-4">{renderNodes(template.layouts.full, [])}</ul>

        {unplaced.length > 0 && (
          <section className="space-y-2 rounded-lg border border-dashed p-3">
            <h3 className="text-sm font-semibold">Fora da ficha</h3>
            <p className="text-muted-foreground text-xs">
              Estes campos aparecem no fim da ficha, em "Outros campos". Arraste-os para uma seção
              ou use o menu do campo.
            </p>
            <SortableContext
              items={unplaced.map((field) => fieldDragId(field.id))}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">{unplaced.map((field) => rowFor(field, null, 0))}</ul>
            </SortableContext>
          </section>
        )}

        <DragOverlay>
          {draggingLabel !== undefined && (
            <div className="bg-card rounded-md border px-3 py-2 font-medium shadow-lg">
              {draggingLabel || 'Sem nome'}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <Button
        variant="outline"
        onClick={() => apply((t) => addSection(t, `Seção ${t.layouts.full.length + 1}`))}
      >
        <PlusIcon /> Nova seção
      </Button>

      <AddFieldDialog
        open={adding !== null}
        onClose={() => setAdding(null)}
        onCreate={(type, label) => {
          if (!adding) return;
          const result = addField(template, type, label, adding);
          apply(() => result.template);
          setAdding(null);
          onEditField(result.fieldId);
        }}
      />

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{toDelete?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {referencing.length > 0
                ? `As fórmulas de ${referencing.map((f) => `"${f.label}"`).join(', ')} usam este campo e vão precisar de ajuste.`
                : 'Nenhuma fórmula usa este campo.'}{' '}
              Fichas já criadas guardam o valor antigo, e ele volta se o campo for recriado com o
              mesmo apelido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (toDelete) apply((t) => removeField(t, toDelete.id));
                setToDelete(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FieldRow({
  field,
  path,
  siblings,
  issues,
  sections,
  apply,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  field: FieldDef;
  path: NodePath | null;
  siblings: number;
  issues: Issue[] | undefined;
  sections: { path: number[]; title: string }[];
  apply: Apply;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: fieldDragId(field.id) });
  const index = path?.at(-1) ?? 0;
  const name = field.label || 'Campo sem nome';

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'bg-card flex items-center gap-2 rounded-md border py-2 pr-1 pl-1',
        issues && 'border-destructive/50',
        isDragging && 'opacity-40',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Arrastar ${name}`}
        className="text-muted-foreground hover:text-foreground cursor-grab touch-none rounded p-1"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-4" />
      </button>
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col items-start text-left"
        onClick={onEdit}
      >
        <span className="max-w-full truncate font-medium">{name}</span>
        <span className="text-muted-foreground max-w-full truncate text-xs">
          {FIELD_TYPE_LABELS[field.type]} · <code>@{field.key}</code>
        </span>
      </button>
      {issues && (
        <Badge variant="destructive" title={issues.map((i) => i.message).join('\n')}>
          <CircleAlertIcon /> {issues.length}
        </Badge>
      )}
      {field.visibility === 'gm' && (
        <Badge variant="outline" title="Visível só para o Mestre">
          <EyeOffIcon />
          <span className="hidden sm:inline">Mestre</span>
        </Badge>
      )}
      <Button variant="ghost" size="icon" aria-label={`Editar ${name}`} onClick={onEdit}>
        <PencilIcon />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Mais ações para ${name}`}>
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {path && (
            <>
              <DropdownMenuItem
                disabled={index === 0}
                onSelect={() => apply((t) => moveNode(t, path, -1))}
              >
                <ArrowUpIcon /> Subir
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index === siblings - 1}
                onSelect={() => apply((t) => moveNode(t, path, 1))}
              >
                <ArrowDownIcon /> Descer
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onSelect={onDuplicate}>
            <CopyIcon /> Duplicar
          </DropdownMenuItem>
          {sections.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Mover para</DropdownMenuLabel>
              {sections.map((section) => (
                <DropdownMenuItem
                  key={section.path.join('.')}
                  onSelect={() => apply((t) => moveFieldToSection(t, field.id, section.path))}
                >
                  {section.title}
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2Icon /> Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function SectionCard({
  node,
  path,
  isFirst,
  isLast,
  apply,
  onAddField,
  children,
}: {
  node: LayoutNode & { kind: 'section' };
  path: NodePath;
  isFirst: boolean;
  isLast: boolean;
  apply: Apply;
  onAddField: () => void;
  children: React.ReactNode;
}) {
  const base = useId();
  const nested = path.length > 1;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sectionDragId(path) });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: insideDropId(path) });
  const title = node.title || 'Seção sem título';

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'space-y-3 rounded-lg border p-3',
        nested ? 'bg-muted/30' : 'bg-card',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Arrastar seção ${title}`}
          className="text-muted-foreground hover:text-foreground cursor-grab touch-none rounded p-1"
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-4" />
        </button>
        <Input
          aria-label="Título da seção"
          className="min-w-32 flex-1 font-semibold"
          value={node.title}
          maxLength={100}
          onChange={(event) =>
            apply(
              (t) => updateSection(t, path, { title: event.target.value }),
              `titulo:${path.join('.')}`,
            )
          }
        />
        <Select
          value={String(node.columns)}
          onValueChange={(value) =>
            apply((t) => updateSection(t, path, { columns: Number(value) as Columns }))
          }
        >
          <SelectTrigger id={`${base}-colunas`} aria-label="Colunas da seção" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4].map((columns) => (
              <SelectItem key={columns} value={String(columns)}>
                {columns} {columns === 1 ? 'coluna' : 'colunas'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Subir seção ${title}`}
            disabled={isFirst}
            onClick={() => apply((t) => moveNode(t, path, -1))}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Descer seção ${title}`}
            disabled={isLast}
            onClick={() => apply((t) => moveNode(t, path, 1))}
          >
            <ArrowDownIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Excluir seção ${title}`}
            title={node.children.length > 0 ? 'Mova ou exclua os campos antes' : undefined}
            disabled={node.children.length > 0}
            onClick={() => apply((t) => removeSection(t, path))}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <ul className="space-y-2">{children}</ul>
      {/* Área de soltar no fim da seção (também recebe campos numa seção vazia). */}
      <div
        ref={setDropRef}
        className={cn(
          'text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm transition-colors',
          isOver ? 'border-primary bg-primary/5 text-foreground' : 'border-transparent',
          node.children.length === 0 && !isOver && 'border-border',
        )}
      >
        {node.children.length === 0 ? 'Seção vazia: arraste campos para cá.' : null}
        <Button
          variant="outline"
          size="sm"
          className={cn(node.children.length === 0 && 'ml-2')}
          onClick={onAddField}
        >
          <PlusIcon /> Campo
        </Button>
      </div>
    </li>
  );
}

function AddFieldDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (type: FieldType, label: string) => void;
}) {
  const base = useId();
  const [label, setLabel] = useState('');
  const [type, setType] = useState<FieldType>('number');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    onCreate(type, label.trim());
    setLabel('');
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Novo campo</DialogTitle>
            <DialogDescription>Os detalhes podem ser ajustados em seguida.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${base}-nome`}>Nome na ficha</Label>
            <Input
              id={`${base}-nome`}
              value={label}
              maxLength={100}
              autoFocus
              placeholder="Ex.: Força"
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Tipo</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((option) => (
                <label
                  key={option}
                  className={cn(
                    'hover:bg-accent flex cursor-pointer flex-col rounded-md border p-2 text-sm',
                    type === option && 'border-primary bg-accent',
                  )}
                >
                  <input
                    type="radio"
                    name={`${base}-tipo`}
                    value={option}
                    checked={type === option}
                    onChange={() => setType(option)}
                    className="sr-only"
                  />
                  <span className="font-medium">{FIELD_TYPE_LABELS[option]}</span>
                  <span className="text-muted-foreground text-xs">{TYPE_HINTS[option]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="submit" disabled={!label.trim()}>
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
