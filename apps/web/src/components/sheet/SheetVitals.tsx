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
import { HeartIcon, SwordIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatNumber, parseNumber } from './format';
import { CheckButton } from './roll-context';

/** Campos em destaque: os do card do Mestre (`gmSummary`) ou, sem ele, os recursos. */
export function vitalFields(compiled: CompiledTemplate, hidden?: ReadonlySet<string>): FieldDef[] {
  const ids = compiled.template.layouts.gmSummary;
  const fields = ids?.length
    ? ids.map((id) => compiled.fieldsById.get(id)).filter((f): f is FieldDef => Boolean(f))
    : compiled.template.fields.filter((f) => f.type === 'resource').slice(0, 4);
  return fields.filter((f) => !hidden?.has(f.id));
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
        <span className="font-semibold tabular-nums">
          {formatNumber(value.current)}
          {max !== undefined && (
            <span className="text-muted-foreground font-normal"> / {formatNumber(max)}</span>
          )}
          {value.temp ? <span className="text-sky-500"> +{formatNumber(value.temp)}</span> : null}
        </span>
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

function selectedLabels(field: FieldOf<'select'>, value: FieldValue | undefined): string[] {
  const current = value ?? defaultValue(field);
  const selected = Array.isArray(current)
    ? (current as string[])
    : typeof current === 'string' && current
      ? [current]
      : [];
  return field.options.filter((o) => selected.includes(o.value)).map((o) => o.label);
}

/**
 * Painel fixo no topo da ficha: o que muda a cada turno (PV, CA, condições…) fica sempre à
 * vista, com dano e cura em um toque, mesmo rolando a ficha.
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

  const resources = fields.filter((f): f is FieldOf<'resource'> => f.type === 'resource');
  const chips = fields.filter((f) => f.type === 'select' || f.type === 'boolean');
  const grouped = new Set<string>([...resources, ...chips].map((f) => f.id));
  const tiles = fields.filter((f) => !grouped.has(f.id));

  return (
    <section
      aria-label="Resumo do personagem"
      className="bg-background/95 sticky top-14 z-[5] -mx-4 border-b px-4 py-3 backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {resources.map((field) => {
          const value = (values[field.id] ?? defaultValue(field)) as ResourceValue;
          const computedMax = derived.resourceMax[field.id];
          const max =
            field.max === undefined ? value.max : computedMax?.ok ? computedMax.value : undefined;
          return (
            <ResourceVital
              key={field.id}
              field={field}
              value={value}
              max={max}
              onChange={(next) => onChange(field.id, next)}
            />
          );
        })}
        {/* No celular, os números ficam numa linha só, com rolagem lateral: o painel fixo
            não pode tomar a tela. */}
        <div className="-mx-1 flex max-w-full gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {tiles.map((field) => {
            const result = field.type === 'computed' ? derived.computed[field.id] : undefined;
            const raw = values[field.id] ?? defaultValue(field);
            const text =
              field.type === 'computed'
                ? result?.ok
                  ? formatNumber(result.value, field.signed)
                  : '—'
                : typeof raw === 'number'
                  ? formatNumber(raw)
                  : typeof raw === 'string' && raw
                    ? raw
                    : '—';
            return (
              <div
                key={field.id}
                className="flex min-w-16 shrink-0 flex-col items-center rounded-md border px-2.5 py-1"
              >
                <span
                  className="text-muted-foreground line-clamp-2 max-w-24 text-center text-[11px] leading-tight"
                  title={field.label}
                >
                  {field.label}
                </span>
                <span className="flex items-center text-lg font-semibold tabular-nums">
                  {text}
                  {field.type === 'computed' && field.signed && result?.ok && (
                    <CheckButton label={field.label} modifier={result.value} />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Estados">
          {chips.flatMap((field) =>
            field.type === 'boolean'
              ? (values[field.id] ?? defaultValue(field)) === true
                ? [
                    <Badge key={field.id} variant="secondary">
                      {field.label}
                    </Badge>,
                  ]
                : []
              : field.type === 'select'
                ? selectedLabels(field, values[field.id]).map((label) => (
                    <Badge key={`${field.id}-${label}`} variant="secondary">
                      {label}
                    </Badge>
                  ))
                : [],
          )}
        </div>
      )}
    </section>
  );
}
