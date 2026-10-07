import {
  addField,
  addSection,
  FIELD_TYPE_LABELS,
  fieldsReferencing,
  moveFieldToSection,
  moveNode,
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
  EyeOffIcon,
  FolderInputIcon,
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

type Apply = (change: (template: SystemTemplate) => SystemTemplate) => void;

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
  const fieldsById = new Map(template.fields.map((f) => [f.id, f]));
  const sections = sectionsOf(template.layouts.full);
  const placed = new Set(fieldsIn(template.layouts.full));
  const unplaced = template.fields.filter((f) => !placed.has(f.id));

  const fieldRow = (field: FieldDef, path: NodePath | null, siblings: number) => {
    const fieldIssues = issues.get(field.id);
    const index = path?.at(-1) ?? 0;
    return (
      <li
        key={field.id}
        className={cn(
          'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2',
          fieldIssues && 'border-destructive/50',
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 flex-col items-start text-left"
          onClick={() => onEditField(field.id)}
        >
          <span className="truncate font-medium">{field.label || 'Campo sem nome'}</span>
          <span className="text-muted-foreground text-xs">
            {FIELD_TYPE_LABELS[field.type]} · <code>@{field.key}</code>
          </span>
        </button>
        {fieldIssues && (
          <Badge variant="destructive" title={fieldIssues.map((i) => i.message).join('\n')}>
            <CircleAlertIcon /> {fieldIssues.length}
          </Badge>
        )}
        {field.visibility === 'gm' && (
          <Badge variant="outline" title="Visível só para o Mestre">
            <EyeOffIcon /> Mestre
          </Badge>
        )}
        <div className="flex">
          {path && (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Subir ${field.label}`}
                disabled={index === 0}
                onClick={() => apply((t) => moveNode(t, path, -1))}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Descer ${field.label}`}
                disabled={index === siblings - 1}
                onClick={() => apply((t) => moveNode(t, path, 1))}
              >
                <ArrowDownIcon />
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Mover ${field.label} para outra seção`}
              >
                <FolderInputIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Mover para</DropdownMenuLabel>
              {sections.map((section) => (
                <DropdownMenuItem
                  key={section.path.join('.')}
                  onSelect={() => apply((t) => moveFieldToSection(t, field.id, section.path))}
                >
                  {section.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Editar ${field.label}`}
            onClick={() => onEditField(field.id)}
          >
            <PencilIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Excluir ${field.label}`}
            onClick={() => setToDelete(field)}
          >
            <Trash2Icon />
          </Button>
        </div>
      </li>
    );
  };

  const renderNodes = (nodes: readonly LayoutNode[], prefix: number[]) =>
    nodes.map((node, index) => {
      const path = [...prefix, index];
      if (node.kind === 'field') {
        const field = fieldsById.get(node.fieldId);
        return field ? fieldRow(field, path, nodes.length) : null;
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
    });

  const referencing = toDelete ? fieldsReferencing(template, toDelete.key) : [];

  return (
    <div className="space-y-4">
      <ul className="space-y-4">{renderNodes(template.layouts.full, [])}</ul>

      {unplaced.length > 0 && (
        <section className="space-y-2 rounded-lg border border-dashed p-3">
          <h3 className="text-sm font-semibold">Fora da ficha</h3>
          <p className="text-muted-foreground text-xs">
            Estes campos aparecem no fim da ficha, em "Outros campos". Use o botão de mover para
            colocá-los numa seção.
          </p>
          <ul className="space-y-2">{unplaced.map((field) => fieldRow(field, null, 0))}</ul>
        </section>
      )}

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
  return (
    <li className={cn('space-y-3 rounded-lg border p-3', nested ? 'bg-muted/30' : 'bg-card')}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Título da seção"
          className="min-w-40 flex-1 font-semibold"
          value={node.title}
          maxLength={100}
          onChange={(event) => apply((t) => updateSection(t, path, { title: event.target.value }))}
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
            aria-label={`Subir seção ${node.title}`}
            disabled={isFirst}
            onClick={() => apply((t) => moveNode(t, path, -1))}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Descer seção ${node.title}`}
            disabled={isLast}
            onClick={() => apply((t) => moveNode(t, path, 1))}
          >
            <ArrowDownIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Excluir seção ${node.title}`}
            title={node.children.length > 0 ? 'Mova ou exclua os campos antes' : undefined}
            disabled={node.children.length > 0}
            onClick={() => apply((t) => removeSection(t, path))}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      {node.children.length === 0 && <p className="text-muted-foreground text-sm">Seção vazia.</p>}
      <ul className="space-y-2">{children}</ul>
      <Button variant="outline" size="sm" onClick={onAddField}>
        <PlusIcon /> Campo
      </Button>
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
