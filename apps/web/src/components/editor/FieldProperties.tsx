import {
  createItemField,
  FIELD_TYPE_LABELS,
  ITEM_FIELD_TYPES,
  keyFromLabel,
  uniqueName,
  withType,
  type FieldDef,
  type FieldOf,
  type ItemFieldType,
  type ListItemFieldDef,
} from '@tabula/domain';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useId, useState } from 'react';
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
import { parseNumber } from '@/components/sheet/format';
import { FormulaInput } from './FormulaInput';

type AnyField = FieldDef | ListItemFieldDef;

/** Número opcional: vazio significa "sem valor". Aceita vírgula decimal. */
export function OptionalNumber({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [seen, setSeen] = useState(value);
  // Valor trocado de fora (ex.: desfazer): mostra o novo.
  if (value !== seen) {
    setSeen(value);
    setText(value === undefined ? '' : String(value));
  }
  const parsed = parseNumber(text);
  return (
    <Input
      id={id}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      aria-invalid={text.trim() !== '' && parsed === null}
      className="tabular-nums"
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const number = parseNumber(next);
        if (next.trim() === '') {
          setSeen(undefined);
          onChange(undefined);
        } else if (number !== null) {
          setSeen(number);
          onChange(number);
        }
      }}
    />
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-3">{children}</div>;
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function CheckRow({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id} className="font-normal">
        {children}
      </Label>
    </div>
  );
}

/** Remove a propriedade quando o valor fica vazio (o schema não aceita `undefined`). */
function set<T extends object, K extends keyof T>(object: T, key: K, value: T[K] | undefined): T {
  const { [key]: _, ...rest } = object;
  return value === undefined || value === '' ? (rest as T) : ({ ...rest, [key]: value } as T);
}

// ---------- Escolha ----------

function OptionsEditor({
  field,
  onChange,
}: {
  field: FieldOf<'select'>;
  onChange: (field: FieldOf<'select'>) => void;
}) {
  const base = useId();
  const options = field.options;
  const update = (next: FieldOf<'select'>['options']) => {
    const values = new Set(next.map((o) => o.value));
    // Padrões que apontavam para opções removidas deixam de existir.
    const fallback =
      field.default === undefined
        ? undefined
        : Array.isArray(field.default)
          ? field.default.filter((v) => values.has(v))
          : values.has(field.default)
            ? field.default
            : undefined;
    onChange(set({ ...field, options: next }, 'default', fallback));
  };
  const move = (index: number, delta: number) => {
    const next = [...options];
    const [item] = next.splice(index, 1);
    if (item) next.splice(index + delta, 0, item);
    update(next);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Opções</p>
      <p className="text-muted-foreground text-xs">
        O número é opcional: é o valor da opção em fórmulas (ex.: tamanho Pequeno = +1).
      </p>
      <ul className="space-y-2">
        {options.map((option, index) => (
          <li key={option.value} className="flex items-center gap-2">
            <Input
              aria-label={`Opção ${index + 1}`}
              value={option.label}
              onChange={(event) =>
                update(
                  options.map((o, i) => (i === index ? { ...o, label: event.target.value } : o)),
                )
              }
            />
            <div className="w-20 shrink-0">
              <OptionalNumber
                id={`${base}-n${index}`}
                value={option.number}
                placeholder="nº"
                onChange={(number) =>
                  update(options.map((o, i) => (i === index ? set(o, 'number', number) : o)))
                }
              />
            </div>
            <code
              className="text-muted-foreground hidden w-24 truncate text-xs sm:block"
              title="Código usado em is()"
            >
              {option.value}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Subir ${option.label}`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Descer ${option.label}`}
              disabled={index === options.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remover ${option.label}`}
              disabled={options.length === 1}
              onClick={() => update(options.filter((_, i) => i !== index))}
            >
              <Trash2Icon />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const label = `Opção ${options.length + 1}`;
          // O código nasce do rótulo e nunca muda: fichas e fórmulas guardam o código.
          const value = uniqueName(keyFromLabel(label), new Set(options.map((o) => o.value)));
          update([...options, { value, label }]);
        }}
      >
        <PlusIcon /> Opção
      </Button>
      <div className="flex flex-wrap gap-4 pt-1">
        <CheckRow
          id={`${base}-multipla`}
          checked={field.multiple === true}
          onChange={(multiple) => {
            const { default: _, ...rest } = field;
            onChange(set(rest as FieldOf<'select'>, 'multiple', multiple || undefined));
          }}
        >
          Permitir marcar várias
        </CheckRow>
      </div>
      {!field.multiple && (
        <Field label="Opção inicial" htmlFor={`${base}-padrao`}>
          <Select
            value={typeof field.default === 'string' ? field.default : '__nenhuma'}
            onValueChange={(value) =>
              onChange(set(field, 'default', value === '__nenhuma' ? undefined : value))
            }
          >
            <SelectTrigger id={`${base}-padrao`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__nenhuma">Nenhuma</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label || option.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  );
}

// ---------- Lista ----------

function ItemFieldsEditor({
  field,
  onChange,
}: {
  field: FieldOf<'list'>;
  onChange: (field: FieldOf<'list'>) => void;
}) {
  const base = useId();
  const [open, setOpen] = useState<string | null>(null);
  const items = field.itemFields;
  const update = (itemFields: ListItemFieldDef[]) => onChange({ ...field, itemFields });

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Colunas de cada item</p>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={item.id} className="rounded-md border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`Coluna ${index + 1}`}
                className="min-w-32 flex-1"
                value={item.label}
                onChange={(event) =>
                  update(
                    items.map((f, i) => (i === index ? { ...f, label: event.target.value } : f)),
                  )
                }
              />
              <Select
                value={item.type}
                onValueChange={(type) =>
                  update(
                    items.map((f, i) =>
                      i === index ? (withType(f, type as ItemFieldType) as ListItemFieldDef) : f,
                    ),
                  )
                }
              >
                <SelectTrigger aria-label={`Tipo da coluna ${item.label}`} className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEM_FIELD_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {FIELD_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={open === item.id}
                onClick={() => setOpen(open === item.id ? null : item.id)}
              >
                Detalhes
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover coluna ${item.label}`}
                disabled={items.length === 1}
                onClick={() => update(items.filter((_, i) => i !== index))}
              >
                <Trash2Icon />
              </Button>
            </div>
            {open === item.id && (
              <div className="mt-3 border-t pt-3">
                <FieldProperties
                  field={item}
                  fields={[]}
                  formulaInvalid={false}
                  onChange={(next) =>
                    update(items.map((f, i) => (i === index ? (next as ListItemFieldDef) : f)))
                  }
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          update([...items, createItemField('number', `Coluna ${items.length + 1}`, items)])
        }
      >
        <PlusIcon /> Coluna
      </Button>
      <Field label="Máximo de itens (opcional)" htmlFor={`${base}-max`}>
        <OptionalNumber
          id={`${base}-max`}
          value={field.maxItems}
          onChange={(maxItems) => onChange(set(field, 'maxItems', maxItems))}
        />
      </Field>
    </div>
  );
}

// ---------- Propriedades por tipo ----------

/**
 * Propriedades específicas do tipo do campo (padrão, limites, opções, fórmula…). O nome,
 * o apelido e o tipo ficam no diálogo do campo.
 */
export function FieldProperties({
  field,
  onChange,
  fields,
  formulaInvalid,
}: {
  field: AnyField;
  onChange: (field: AnyField) => void;
  /** Campos do sistema, para sugerir referências nas fórmulas. */
  fields: readonly FieldDef[];
  formulaInvalid: boolean;
}) {
  const base = useId();
  const textDefault = (f: FieldOf<'text' | 'longtext' | 'dice'>) => (
    <Field label="Valor inicial" htmlFor={`${base}-padrao`}>
      <Input
        id={`${base}-padrao`}
        value={f.default ?? ''}
        placeholder={f.type === 'dice' ? 'Ex.: 1d8+2' : undefined}
        onChange={(event) => onChange(set(f, 'default', event.target.value))}
      />
    </Field>
  );

  switch (field.type) {
    case 'number':
      return (
        <div className="space-y-3">
          <Row>
            <Field label="Valor inicial" htmlFor={`${base}-padrao`}>
              <OptionalNumber
                id={`${base}-padrao`}
                value={field.default}
                onChange={(value) => onChange(set(field, 'default', value))}
              />
            </Field>
            <Field label="Mínimo" htmlFor={`${base}-min`}>
              <OptionalNumber
                id={`${base}-min`}
                value={field.min}
                onChange={(value) => onChange(set(field, 'min', value))}
              />
            </Field>
            <Field label="Máximo" htmlFor={`${base}-max`}>
              <OptionalNumber
                id={`${base}-max`}
                value={field.max}
                onChange={(value) => onChange(set(field, 'max', value))}
              />
            </Field>
          </Row>
          <CheckRow
            id={`${base}-inteiro`}
            checked={field.integer === true}
            onChange={(integer) => onChange(set(field, 'integer', integer || undefined))}
          >
            Só números inteiros
          </CheckRow>
        </div>
      );
    case 'text':
    case 'longtext':
    case 'dice':
      return textDefault(field);
    case 'boolean':
      return (
        <CheckRow
          id={`${base}-padrao`}
          checked={field.default === true}
          onChange={(value) => onChange(set(field, 'default', value || undefined))}
        >
          Começa marcado
        </CheckRow>
      );
    case 'select':
      return <OptionsEditor field={field} onChange={onChange} />;
    case 'resource':
      return (
        <div className="space-y-3">
          <Field label="Valor inicial" htmlFor={`${base}-padrao`}>
            <OptionalNumber
              id={`${base}-padrao`}
              value={field.default}
              onChange={(value) => onChange(set(field, 'default', value))}
            />
          </Field>
          <CheckRow
            id={`${base}-calculado`}
            checked={field.max !== undefined}
            onChange={(calculated) => onChange(set(field, 'max', calculated ? '10' : undefined))}
          >
            Máximo calculado por fórmula
          </CheckRow>
          {field.max !== undefined && (
            <Field label="Fórmula do máximo" htmlFor={`${base}-max`}>
              <FormulaInput
                id={`${base}-max`}
                value={field.max}
                fields={fields}
                selfId={field.id}
                invalid={formulaInvalid}
                onChange={(max) => onChange({ ...field, max })}
              />
            </Field>
          )}
        </div>
      );
    case 'computed':
      return (
        <div className="space-y-3">
          <Field label="Fórmula" htmlFor={`${base}-formula`}>
            <FormulaInput
              id={`${base}-formula`}
              value={field.formula}
              fields={fields}
              selfId={field.id}
              invalid={formulaInvalid}
              onChange={(formula) => onChange({ ...field, formula })}
            />
          </Field>
          <CheckRow
            id={`${base}-sinal`}
            checked={field.signed === true}
            onChange={(signed) => onChange(set(field, 'signed', signed || undefined))}
          >
            Mostrar sinal em positivos (ex.: +3), como em modificadores
          </CheckRow>
        </div>
      );
    case 'list':
      return <ItemFieldsEditor field={field} onChange={onChange} />;
  }
}
