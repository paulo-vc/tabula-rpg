import {
  defaultValue,
  type CompiledTemplate,
  type DerivedValues,
  type FieldDef,
  type FieldOf,
  type FieldValue,
  type ResourceValue,
  type SheetValues,
} from '@tabula/domain';
import { HeartIcon, PencilIcon, SwordIcon, XIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NumberInput, PrimitiveInput } from './fields';
import { formatNumber, parseNumber } from './format';
import { markCount, Marks } from './Marks';
import { CheckButton } from './roll-context';

/** Campos em destaque: os do card do Mestre (`gmSummary`) ou, sem ele, os recursos. */
export function vitalFields(compiled: CompiledTemplate, hidden?: ReadonlySet<string>): FieldDef[] {
  const ids = compiled.template.layouts.gmSummary;
  const fields = ids?.length
    ? ids.map((id) => compiled.fieldsById.get(id)).filter((f): f is FieldDef => Boolean(f))
    : compiled.template.fields.filter((f) => f.type === 'resource').slice(0, 4);
  return fields.filter((f) => !hidden?.has(f.id));
}

/** O painel edita esses tipos por completo; os demais (texto, lista…) continuam na ficha. */
const panelEdits = (field: FieldDef): boolean =>
  field.type === 'number' ||
  field.type === 'computed' ||
  field.type === 'resource' ||
  field.type === 'boolean' ||
  (field.type === 'select' && field.multiple === true);

/**
 * Campos que ficam só no painel fixo e saem das abas: mostrar e editar o mesmo valor em
 * dois lugares confunde e gasta espaço. Campos secretos ficam nas abas, onde aparecem
 * marcados como "só o Mestre vê".
 */
export function pinnedFieldIds(
  compiled: CompiledTemplate,
  hidden?: ReadonlySet<string>,
  secret?: ReadonlySet<string>,
): Set<string> {
  return new Set(
    vitalFields(compiled, hidden)
      .filter((field) => panelEdits(field) && !secret?.has(field.id))
      .map((field) => field.id),
  );
}

/**
 * Dano tira primeiro dos pontos temporários; cura não passa do máximo (se houver).
 * Ex.: PV 10/20 com 3 temporários, 5 de dano → 8/20, 0 temporários.
 */
export function applyToResource(
  value: ResourceValue,
  amount: number,
  kind: 'dano' | 'cura',
  max: number | undefined,
): ResourceValue {
  if (kind === 'cura') {
    const healed = value.current + amount;
    return { ...value, current: max === undefined ? healed : Math.min(max, healed) };
  }
  const temp = value.temp ?? 0;
  const absorbed = Math.min(temp, amount);
  const next: ResourceValue = { ...value, current: value.current - (amount - absorbed) };
  if (value.temp !== undefined) next.temp = temp - absorbed;
  return next;
}

const asNumber = (field: FieldDef, suffix: string, label: string): FieldOf<'number'> => ({
  id: `${field.id}-${suffix}`,
  key: field.key,
  label,
  type: 'number',
});

/** Ajuste exato de um recurso (atual, máximo digitado e temporários), aberto pelo número. */
function ResourceEditor({
  field,
  value,
  max,
  onChange,
}: {
  field: FieldOf<'resource'>;
  value: ResourceValue;
  max: number | undefined;
  onChange: (value: ResourceValue) => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="space-y-1">
        <Label htmlFor={`${id}-atual`} className="text-xs">
          Atual
        </Label>
        <NumberInput
          compact
          id={`${id}-atual`}
          field={asNumber(field, 'atual', 'Atual')}
          value={value.current}
          onChange={(current) => onChange({ ...value, current: current as number })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-max`} className="text-xs">
          Máximo
        </Label>
        {field.max === undefined ? (
          <NumberInput
            compact
            id={`${id}-max`}
            field={asNumber(field, 'max', 'Máximo')}
            value={value.max ?? 0}
            onChange={(next) => onChange({ ...value, max: next as number })}
          />
        ) : (
          <output
            id={`${id}-max`}
            title={`Calculado: ${field.max}`}
            className="flex h-8 items-center text-sm font-semibold tabular-nums"
          >
            {max === undefined ? '—' : formatNumber(max)}
          </output>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-temp`} className="text-xs">
          Temporários
        </Label>
        <NumberInput
          compact
          id={`${id}-temp`}
          field={{ ...asNumber(field, 'temp', 'Temporários'), min: 0 }}
          value={value.temp ?? 0}
          onChange={(temp) => {
            const { temp: _old, ...rest } = value;
            onChange((temp as number) > 0 ? { ...rest, temp: temp as number } : rest);
          }}
        />
      </div>
    </div>
  );
}

function ResourceVital({
  field,
  value,
  max,
  onChange,
}: {
  field: FieldOf<'resource'>;
  value: ResourceValue;
  max: number | undefined;
  onChange: (value: ResourceValue) => void;
}) {
  const [amount, setAmount] = useState('');
  const parsed = parseNumber(amount);
  const valid = parsed !== null && parsed > 0;
  const percent = max && max > 0 ? Math.max(0, Math.min(100, (value.current / max) * 100)) : 0;
  const apply = (kind: 'dano' | 'cura') => {
    if (!valid) return;
    onChange(applyToResource(value, parsed, kind, max));
    setAmount('');
  };

  return (
    <div className="min-w-56 flex-1 space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{field.label}</span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Ajustar ${field.label}`}
              title="Ajustar valores"
              className="hover:bg-muted focus-visible:ring-ring/50 -mx-1 rounded px-1 font-semibold tabular-nums outline-none focus-visible:ring-[3px]"
            >
              {formatNumber(value.current)}
              {max !== undefined && (
                <span className="text-muted-foreground font-normal"> / {formatNumber(max)}</span>
              )}
              {value.temp ? (
                <span className="text-sky-500"> +{formatNumber(value.temp)}</span>
              ) : null}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" aria-label={`Ajustar ${field.label}`}>
            <ResourceEditor field={field} value={value} max={max} onChange={onChange} />
          </PopoverContent>
        </Popover>
      </div>
      <div
        role="meter"
        aria-label={`${field.label}: ${formatNumber(value.current)}${max !== undefined ? ` de ${formatNumber(max)}` : ''}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="bg-muted h-2 overflow-hidden rounded-full"
      >
        <div
          className={cn(
            'h-full transition-[width]',
            percent > 50 ? 'bg-emerald-500' : percent > 25 ? 'bg-amber-500' : 'bg-red-500',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <form
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          apply('dano');
        }}
      >
        <Input
          aria-label={`Quanto de ${field.label}`}
          inputMode="numeric"
          placeholder="Qtd."
          value={amount}
          className="h-8 w-16 text-center"
          onChange={(event) => setAmount(event.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!valid}>
          <SwordIcon /> Dano
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!valid}
          onClick={() => apply('cura')}
        >
          <HeartIcon /> Cura
        </Button>
      </form>
    </div>
  );
}

/** Bloco pequeno do painel: rótulo em cima, valor (ou controle) embaixo. */
function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-16 shrink-0 flex-col items-center gap-0.5 rounded-md border px-2.5 py-1">
      <span
        className="text-muted-foreground line-clamp-2 max-w-24 text-center text-[11px] leading-tight"
        title={label}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function selected(field: FieldOf<'select'>, value: FieldValue | undefined): string[] {
  const current = value ?? defaultValue(field);
  return Array.isArray(current)
    ? (current as string[])
    : typeof current === 'string' && current
      ? [current]
      : [];
}

/** Condições (seleção múltipla): só as ativas à vista; as outras, a um clique. */
function MultiSelectVital({
  field,
  value,
  onChange,
}: {
  field: FieldOf<'select'>;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
}) {
  const active = selected(field, value);
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={field.label}>
      {field.options
        .filter((option) => active.includes(option.value))
        .map((option) => (
          <Badge key={option.value} variant="secondary" className="gap-1 pr-1">
            {option.label}
            <button
              type="button"
              aria-label={`Remover ${option.label}`}
              className="hover:bg-foreground/10 rounded-sm"
              onClick={() => onChange(active.filter((v) => v !== option.value))}
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs">
            <PencilIcon /> {field.label}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80" aria-label={field.label}>
          <PrimitiveInput
            field={field}
            label={field.label}
            value={active}
            onChange={(next) => onChange(next as FieldValue)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Painel fixo no topo da ficha: o que muda a cada turno (PV, CA, condições…) fica sempre à
 * vista e editável aqui mesmo, com dano e cura em um toque, mesmo rolando a ficha. Esses
 * campos saem das abas (ver `pinnedFieldIds`).
 */
export function SheetVitals({
  compiled,
  values,
  derived,
  onChange,
  hiddenFieldIds,
}: {
  compiled: CompiledTemplate;
  values: SheetValues;
  derived: DerivedValues;
  onChange: (fieldId: string, value: FieldValue) => void;
  hiddenFieldIds?: ReadonlySet<string> | undefined;
}) {
  const fields = vitalFields(compiled, hiddenFieldIds);
  if (fields.length === 0) return null;

  const resourceMax = (field: FieldOf<'resource'>, value: ResourceValue) => {
    const computed = derived.resourceMax[field.id];
    return field.max === undefined ? value.max : computed?.ok ? computed.value : undefined;
  };
  const resourceValue = (field: FieldOf<'resource'>) =>
    (values[field.id] ?? defaultValue(field)) as ResourceValue;
  const asMarks = (field: FieldOf<'resource'>) =>
    field.display === 'marcadores' ? markCount(resourceMax(field, resourceValue(field))) : null;

  const bars = fields.filter(
    (f): f is FieldOf<'resource'> => f.type === 'resource' && asMarks(f) === null,
  );
  const states = fields.filter((f) => f.type === 'select' || f.type === 'boolean');
  const placed = new Set<string>([...bars, ...states].map((f) => f.id));
  const tiles = fields.filter((f) => !placed.has(f.id));

  const tile = (field: FieldDef) => {
    const raw = values[field.id] ?? defaultValue(field);
    switch (field.type) {
      case 'computed': {
        const result = derived.computed[field.id];
        return (
          <span className="flex items-center text-lg font-semibold tabular-nums">
            <span title={result && !result.ok ? result.error.message : undefined}>
              {result?.ok ? formatNumber(result.value, field.signed) : '—'}
            </span>
            {field.signed && result?.ok && (
              <CheckButton label={field.label} modifier={result.value} />
            )}
          </span>
        );
      }
      case 'resource': {
        const value = resourceValue(field);
        return (
          <Marks
            size="sm"
            label={field.label}
            value={value.current}
            count={asMarks(field) ?? 0}
            onChange={(current) => onChange(field.id, { ...value, current })}
          />
        );
      }
      case 'number': {
        const count = field.display === 'marcadores' ? markCount(field.max) : null;
        if (count !== null) {
          return (
            <Marks
              size="sm"
              label={field.label}
              value={typeof raw === 'number' ? raw : 0}
              count={count}
              onChange={(next) => onChange(field.id, next)}
            />
          );
        }
        return (
          <div className="w-14 [&_input]:h-7 [&_input]:border-transparent [&_input]:bg-transparent [&_input]:text-center [&_input]:text-lg [&_input]:font-semibold [&_input]:shadow-none [&_input:hover]:border-input [&_input:focus]:border-input">
            <NumberInput
              compact
              field={field}
              label={field.label}
              value={typeof raw === 'number' ? raw : 0}
              onChange={(next) => onChange(field.id, next)}
            />
          </div>
        );
      }
      default:
        return (
          <span className="text-lg font-semibold">
            {typeof raw === 'string' && raw ? raw : '—'}
          </span>
        );
    }
  };

  return (
    <section
      aria-label="Resumo do personagem"
      className="bg-background/95 sticky top-14 z-[5] -mx-4 border-b px-4 py-3 backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {bars.map((field) => {
          const value = resourceValue(field);
          return (
            <ResourceVital
              key={field.id}
              field={field}
              value={value}
              max={resourceMax(field, value)}
              onChange={(next) => onChange(field.id, next)}
            />
          );
        })}
        {/* No celular, os números ficam numa linha só, com rolagem lateral: o painel fixo
            não pode tomar a tela. */}
        <div className="-mx-1 flex max-w-full gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {tiles.map((field) => (
            <Tile key={field.id} label={field.label}>
              {tile(field)}
            </Tile>
          ))}
        </div>
      </div>
      {states.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Estados">
          {states.map((field) => {
            if (field.type === 'boolean') {
              const on = (values[field.id] ?? defaultValue(field)) === true;
              return (
                <Badge key={field.id} asChild variant={on ? 'default' : 'outline'}>
                  <button type="button" aria-pressed={on} onClick={() => onChange(field.id, !on)}>
                    {field.label}
                  </button>
                </Badge>
              );
            }
            if (field.type !== 'select') return null;
            if (field.multiple) {
              return (
                <MultiSelectVital
                  key={field.id}
                  field={field}
                  value={values[field.id]}
                  onChange={(next) => onChange(field.id, next)}
                />
              );
            }
            const labels = field.options
              .filter((o) => selected(field, values[field.id]).includes(o.value))
              .map((o) => o.label);
            return labels.map((label) => (
              <Badge key={`${field.id}-${label}`} variant="secondary">
                {label}
              </Badge>
            ));
          })}
        </div>
      )}
    </section>
  );
}
