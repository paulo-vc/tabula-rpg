import type {
  EvaluationError,
  FieldDef,
  FieldOf,
  FieldValue,
  ListItem,
  ListItemFieldDef,
  PrimitiveValue,
  ResourceValue,
  Result,
} from '@tabula/domain';
import { defaultValue, listItemValue } from '@tabula/domain';
import {
  ChevronUpIcon,
  InfoIcon,
  MinusIcon,
  NotebookPenIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatNumber, parseNumber } from './format';
import { markCount, Marks } from './Marks';
import { BonusMark, BonusNote } from './Bonuses';
import { CheckButton, RollButton } from './roll-context';
import { useDraft } from './use-draft';

export type Derived = Result<number, EvaluationError> | undefined;

export interface FieldControlProps {
  field: FieldDef;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  /** Valor calculado (campos `computed`) ou máximo calculado (`resource` com fórmula). */
  derived?: Derived;
  newItemId: () => string;
  /**
   * Sem rótulo nem botão de adicionar: quem mostra o campo já exibe os dois (ex.: uma seção
   * que só contém esta lista, com o título e o "Adicionar" no cabeçalho).
   */
  bare?: boolean | undefined;
}

/** Rótulo do campo, com a descrição (se houver) num ícone de ajuda. */
function FieldLabel({
  field,
  htmlFor,
}: {
  field: FieldDef | ListItemFieldDef;
  htmlFor?: string | undefined;
}) {
  return (
    <div className="flex min-h-5 items-center gap-1">
      <Label htmlFor={htmlFor} className="text-muted-foreground text-xs font-medium">
        {field.label}
      </Label>
      {field.description && (
        <Tooltip>
          <TooltipTrigger
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Ajuda: ${field.label}`}
          >
            <InfoIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{field.description}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ---------- Controles primitivos (também usados dentro de listas) ----------

export interface PrimitiveProps<F extends ListItemFieldDef> {
  field: F;
  value: PrimitiveValue;
  onChange: (value: PrimitiveValue) => void;
  id?: string;
  label?: string;
  compact?: boolean;
}

export function NumberInput({
  field,
  value,
  onChange,
  id,
  label,
  compact,
}: PrimitiveProps<FieldOf<'number'>>) {
  const current = typeof value === 'number' ? value : 0;
  const isValid = (n: number | null): n is number =>
    n !== null && (!field.integer || Number.isInteger(n));
  const { draft, change, blur, setDraft } = useDraft(String(current), (text: string) => {
    const parsed = parseNumber(text);
    if (isValid(parsed)) onChange(parsed);
  });
  const parsed = parseNumber(draft);
  const outOfRange =
    parsed !== null &&
    ((field.min !== undefined && parsed < field.min) ||
      (field.max !== undefined && parsed > field.max));

  return (
    <Input
      id={id}
      aria-label={label}
      inputMode={field.integer ? 'numeric' : 'decimal'}
      value={draft}
      aria-invalid={!isValid(parsed) || outOfRange}
      title={outOfRange ? `Sugerido: ${field.min ?? '−∞'} a ${field.max ?? '∞'}` : undefined}
      className={cn('tabular-nums', compact ? 'h-8' : 'text-center text-lg font-semibold')}
      onChange={(event) => change(event.target.value)}
      onBlur={() => {
        blur();
        if (!isValid(parseNumber(draft))) setDraft(String(current));
      }}
    />
  );
}

function TextInput({
  field,
  value,
  onChange,
  id,
  label,
  compact,
}: PrimitiveProps<FieldOf<'text'> | FieldOf<'dice'>>) {
  const { draft, change, blur } = useDraft(typeof value === 'string' ? value : '', onChange);
  const input = (
    <Input
      id={id}
      aria-label={label}
      value={draft}
      maxLength={field.type === 'dice' ? 100 : 10_000}
      className={cn(compact && 'h-8', field.type === 'dice' && 'font-mono')}
      placeholder={field.type === 'dice' ? 'ex.: 1d8+3' : undefined}
      onChange={(event) => change(event.target.value)}
      onBlur={blur}
    />
  );
  if (field.type !== 'dice') return input;
  return (
    <div className="flex items-center gap-1">
      {input}
      <RollButton label={label ?? field.label} expression={draft} />
    </div>
  );
}

function BooleanInput({ value, onChange, id, label }: PrimitiveProps<FieldOf<'boolean'>>) {
  return (
    <Checkbox
      id={id}
      aria-label={label}
      checked={value === true}
      onCheckedChange={(checked) => onChange(checked === true)}
    />
  );
}

const NONE = '__nenhum__';

function SelectInput({
  field,
  value,
  onChange,
  id,
  label,
  compact,
}: PrimitiveProps<FieldOf<'select'>>) {
  if (field.multiple) {
    const selected = Array.isArray(value) ? value : [];
    const toggle = (option: string) =>
      onChange(
        selected.includes(option) ? selected.filter((v) => v !== option) : [...selected, option],
      );
    return (
      <div role="group" aria-label={label ?? field.label} className="flex flex-wrap gap-1.5">
        {field.options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <Badge key={option.value} asChild variant={active ? 'default' : 'outline'}>
              <button type="button" aria-pressed={active} onClick={() => toggle(option.value)}>
                {option.label}
              </button>
            </Badge>
          );
        })}
      </div>
    );
  }
  const current = typeof value === 'string' && value !== '' ? value : NONE;
  return (
    <Select value={current} onValueChange={(next) => onChange(next === NONE ? '' : next)}>
      <SelectTrigger id={id} aria-label={label} className={cn('w-full', compact && 'h-8')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>—</SelectItem>
        {field.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PrimitiveInput(props: PrimitiveProps<ListItemFieldDef>) {
  const { field } = props;
  switch (field.type) {
    case 'number': {
      const count = field.display === 'marcadores' ? markCount(field.max) : null;
      if (count !== null) {
        return (
          <Marks
            label={props.label ?? field.label}
            value={typeof props.value === 'number' ? props.value : 0}
            count={count}
            onChange={props.onChange}
            size={props.compact ? 'sm' : 'md'}
          />
        );
      }
      return <NumberInput {...props} field={field} />;
    }
    case 'text':
    case 'dice':
      return <TextInput {...props} field={field} />;
    case 'longtext':
      return <LongTextInput {...props} field={field} />;
    case 'boolean':
      return <BooleanInput {...props} field={field} />;
    case 'select':
      return <SelectInput {...props} field={field} />;
  }
}

function LongTextInput({ value, onChange, id, label }: PrimitiveProps<FieldOf<'longtext'>>) {
  const { draft, change, blur } = useDraft(typeof value === 'string' ? value : '', onChange);
  return (
    <Textarea
      id={id}
      aria-label={label}
      value={draft}
      rows={4}
      maxLength={10_000}
      onChange={(event) => change(event.target.value)}
      onBlur={blur}
    />
  );
}

// ---------- Campos compostos ----------

function ComputedDisplay({ field, derived }: { field: FieldOf<'computed'>; derived: Derived }) {
  const text = derived?.ok ? formatNumber(derived.value, field.signed) : '—';
  const output = (
    <output
      aria-label={field.label}
      title={derived && !derived.ok ? derived.error.message : `Calculado: ${field.formula}`}
      className={cn(
        'bg-muted/50 flex h-9 items-center justify-center rounded-md border border-dashed text-lg font-semibold tabular-nums',
        derived && !derived.ok && 'text-destructive',
      )}
    >
      {text}
    </output>
  );
  // Modificadores (com sinal) viram testes: o dado do sistema + o valor.
  if (!field.signed || !derived?.ok) {
    return (
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">{output}</div>
        <BonusMark field={field} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">{output}</div>
      <BonusMark field={field} />
      <CheckButton label={field.label} modifier={derived.value} />
    </div>
  );
}

function ResourceControl({
  field,
  value,
  onChange,
  derived,
}: {
  field: FieldOf<'resource'>;
  value: ResourceValue;
  onChange: (value: ResourceValue) => void;
  derived: Derived;
}) {
  const id = useId();
  const max = field.max === undefined ? value.max : derived?.ok ? derived.value : undefined;
  const percent = max && max > 0 ? Math.max(0, Math.min(100, (value.current / max) * 100)) : 0;
  const setCurrent = (current: number) => onChange({ ...value, current });
  const asNumber = (suffix: string): FieldOf<'number'> => ({
    id: `${field.id}-${suffix}`,
    key: field.key,
    label: field.label,
    type: 'number',
  });

  // Marcadores (ex.: espaços de magia). Sem máximo ainda (0), mostra só onde digitá-lo; com
  // um máximo grande demais para marcadores, volta ao campo numérico abaixo.
  const count = field.display === 'marcadores' ? markCount(max) : null;
  const awaitingMax = field.display === 'marcadores' && field.max === undefined && !max;
  if (count !== null || awaitingMax) {
    return (
      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
        {count !== null ? (
          <Marks label={field.label} value={value.current} count={count} onChange={setCurrent} />
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        )}
        {field.max === undefined && (
          <label className="text-muted-foreground flex items-center gap-1 text-xs">
            máx.
            <span className="w-14">
              <NumberInput
                compact
                label={`${field.label}: máximo`}
                field={{ ...asNumber('max'), integer: true, min: 0 }}
                value={value.max ?? 0}
                onChange={(newMax) => {
                  const next = newMax as number;
                  onChange({ ...value, max: next, current: Math.min(value.current, next) });
                }}
              />
            </span>
          </label>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-72 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={`Diminuir ${field.label}`}
          onClick={() => setCurrent(value.current - 1)}
        >
          <MinusIcon />
        </Button>
        <div className="w-20">
          <NumberInput
            id={id}
            label={`${field.label}: atual`}
            field={asNumber('atual')}
            value={value.current}
            onChange={(current) => setCurrent(current as number)}
          />
        </div>
        <span className="text-muted-foreground">/</span>
        <div className="w-20">
          {field.max === undefined ? (
            <NumberInput
              label={`${field.label}: máximo`}
              field={asNumber('max')}
              value={value.max ?? 0}
              onChange={(newMax) => onChange({ ...value, max: newMax as number })}
            />
          ) : (
            <output
              aria-label={`${field.label}: máximo`}
              title={derived && !derived.ok ? derived.error.message : `Calculado: ${field.max}`}
              className="block text-center text-lg font-semibold tabular-nums"
            >
              {derived?.ok ? formatNumber(derived.value) : '—'}
            </output>
          )}
        </div>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={`Aumentar ${field.label}`}
          onClick={() => setCurrent(value.current + 1)}
        >
          <PlusIcon />
        </Button>
      </div>
      <div
        role="meter"
        aria-label={`${field.label}: proporção`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="bg-muted h-1.5 overflow-hidden rounded-full"
      >
        <div
          className={cn(
            'h-full transition-[width]',
            percent > 50 ? 'bg-emerald-500' : percent > 25 ? 'bg-amber-500' : 'bg-red-500',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function ListControl({
  field,
  items,
  onChange,
  newItemId,
  bare,
}: {
  field: FieldOf<'list'>;
  items: ListItem[];
  onChange: (items: ListItem[]) => void;
  newItemId: () => string;
  bare?: boolean | undefined;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const full = field.maxItems !== undefined && items.length >= field.maxItems;
  // Textos longos (descrição de uma habilidade, de um item) ficam num painel que abre por
  // item: a linha continua curta, e o texto tem espaço quando é preciso.
  const inline = field.itemFields.filter((f) => f.type !== 'longtext');
  const details = field.itemFields.filter((f) => f.type === 'longtext');
  const update = (itemId: string, fieldId: string, value: PrimitiveValue) =>
    onChange(
      items.map((item) =>
        item.id === itemId ? { ...item, values: { ...item.values, [fieldId]: value } } : item,
      ),
    );
  const toggle = (itemId: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  const itemName = (item: ListItem, index: number) => {
    const first = inline.find((f) => f.type === 'text');
    const name = first ? listItemValue(first, item) : '';
    return typeof name === 'string' && name.trim() ? name : `item ${index + 1}`;
  };

  return (
    <div className="space-y-2">
      <ul className="space-y-2 empty:hidden">
        {items.map((item, index) => {
          const expanded = open.has(item.id);
          const hasText = details.some((f) => {
            const value = listItemValue(f, item);
            return typeof value === 'string' && value.trim() !== '';
          });
          return (
            <li key={item.id} className="rounded-md border p-2">
              <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
                {inline.map((itemField) => (
                  <div
                    key={itemField.id}
                    className={cn(
                      'min-w-0',
                      itemField.type === 'boolean'
                        ? 'flex flex-col items-center gap-2 pb-2'
                        : itemField.type === 'number'
                          ? 'w-20 shrink-0'
                          : 'min-w-32 flex-1',
                    )}
                  >
                    {index === 0 && (
                      <span className="text-muted-foreground mb-1 block text-xs">
                        {itemField.label}
                      </span>
                    )}
                    <PrimitiveInput
                      compact
                      field={itemField}
                      label={`${itemField.label} (item ${index + 1})`}
                      value={listItemValue(itemField, item)}
                      onChange={(value) => update(item.id, itemField.id, value)}
                    />
                  </div>
                ))}
                {details.length > 0 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Fechar' : 'Abrir'} descrição de ${itemName(item, index)}`}
                    title={hasText ? 'Tem descrição' : 'Escrever descrição'}
                    onClick={() => toggle(item.id)}
                  >
                    {expanded ? (
                      <ChevronUpIcon />
                    ) : (
                      <NotebookPenIcon className={cn(!hasText && 'opacity-50')} />
                    )}
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remover ${itemName(item, index)}`}
                  onClick={() => onChange(items.filter((i) => i.id !== item.id))}
                >
                  <Trash2Icon />
                </Button>
              </div>
              {expanded && (
                <div className="mt-2 space-y-2 border-t pt-2">
                  {details.map((itemField) => (
                    <div key={itemField.id} className="space-y-1">
                      <span className="text-muted-foreground block text-xs">{itemField.label}</span>
                      <PrimitiveInput
                        field={itemField}
                        label={`${itemField.label} de ${itemName(item, index)}`}
                        value={listItemValue(itemField, item)}
                        onChange={(value) => update(item.id, itemField.id, value)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!bare && (
        <AddItemButton
          label={field.label}
          disabled={full}
          onAdd={() => onChange([...items, { id: newItemId(), values: {} }])}
        />
      )}
    </div>
  );
}

/** Acrescenta um item vazio a uma lista. */
export function AddItemButton({
  label,
  disabled,
  onAdd,
}: {
  label: string;
  disabled?: boolean | undefined;
  onAdd: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      aria-label={`Adicionar em ${label}`}
      onClick={onAdd}
    >
      <PlusIcon /> Adicionar
    </Button>
  );
}

/** Controle de edição de um campo da ficha, escolhido pelo tipo. */
export function FieldControl({
  field,
  value,
  onChange,
  derived,
  newItemId,
  bare,
}: FieldControlProps) {
  const id = useId();
  const current = value ?? defaultValue(field);

  if (field.type === 'boolean') {
    return (
      <div className="flex min-h-9 items-center gap-2">
        <Checkbox
          id={id}
          checked={current === true}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        <Label htmlFor={id} className="text-sm font-normal">
          {field.label}
        </Label>
      </div>
    );
  }

  const control = (() => {
    switch (field.type) {
      case 'computed':
        return <ComputedDisplay field={field} derived={derived} />;
      case 'resource':
        return (
          <ResourceControl
            field={field}
            value={current as ResourceValue}
            onChange={onChange}
            derived={derived}
          />
        );
      case 'list':
        return (
          <ListControl
            field={field}
            items={current as ListItem[]}
            onChange={onChange}
            newItemId={newItemId}
            bare={bare}
          />
        );
      default:
        return (
          <>
            <PrimitiveInput
              id={id}
              field={field}
              value={current as PrimitiveValue}
              onChange={onChange}
            />
            {field.type === 'number' && (
              <BonusNote field={field} base={typeof current === 'number' ? current : undefined} />
            )}
          </>
        );
    }
  })();

  // Listas e seleções múltiplas são grupos de controles, sem um único `input` para o rótulo.
  // (A seleção múltipla já se declara como grupo.)
  const isList = field.type === 'list';
  const marks =
    (field.type === 'number' || field.type === 'resource') && field.display === 'marcadores';
  const labelsInput =
    !isList && !marks && field.type !== 'computed' && !(field.type === 'select' && field.multiple);
  // Um número ocupa o espaço de um número, não a largura inteira da coluna.
  const width =
    (field.type === 'number' && !marks) || field.type === 'computed'
      ? 'max-w-32'
      : field.type === 'dice'
        ? 'max-w-56'
        : undefined;
  return (
    <div
      className="space-y-1"
      role={isList && !bare ? 'group' : undefined}
      aria-label={isList && !bare ? field.label : undefined}
    >
      {!bare && <FieldLabel field={field} htmlFor={labelsInput ? id : undefined} />}
      {width ? <div className={width}>{control}</div> : control}
    </div>
  );
}
