import {
  defaultValue,
  type FieldDef,
  type FieldOf,
  type FieldValue,
  type PrimitiveValue,
} from '@tabula/domain';
import { CircleCheckIcon, CircleIcon } from 'lucide-react';
import { useId } from 'react';
import { cn } from '@/lib/utils';
import { FieldControl, NumberInput, PrimitiveInput, type Derived } from './fields';
import { formatNumber } from './format';
import { CheckButton } from './roll-context';

export interface CompactFieldProps {
  field: FieldDef;
  value: FieldValue | undefined;
  derived: Derived;
  onChange: (value: FieldValue) => void;
  newItemId: () => string;
}

/** Valor calculado em destaque, com o dado de teste se for um modificador. */
function BigComputed({
  field,
  derived,
  size = 'lg',
}: {
  field: FieldOf<'computed'>;
  derived: Derived;
  size?: 'lg' | 'md';
}) {
  const text = derived?.ok ? formatNumber(derived.value, field.signed) : '—';
  return (
    <span className="inline-flex items-center gap-0.5">
      <output
        aria-label={field.label}
        title={derived && !derived.ok ? derived.error.message : `Calculado: ${field.formula}`}
        className={cn(
          'font-semibold tabular-nums',
          size === 'lg' ? 'text-2xl' : 'text-base',
          derived && !derived.ok && 'text-destructive',
        )}
      >
        {text}
      </output>
      {field.signed && derived?.ok && <CheckButton label={field.label} modifier={derived.value} />}
    </span>
  );
}

const currentOf = (field: FieldDef, value: FieldValue | undefined) => value ?? defaultValue(field);

/**
 * Bloco de valor (seções "compactas", como os atributos): o número em destaque e o rótulo
 * pequeno. Com um campo secundário, ele aparece embaixo, pequeno (ex.: o valor 16 sob o
 * modificador +3), e o rótulo do bloco passa a ser o dele ("Força").
 */
export function StatTile({
  main,
  secondary,
}: {
  main: CompactFieldProps;
  secondary?: CompactFieldProps | undefined;
}) {
  const id = useId();
  const title = secondary?.field.label ?? main.field.label;
  const { field } = main;

  const body = (() => {
    if (field.type === 'computed') return <BigComputed field={field} derived={main.derived} />;
    if (field.type === 'number') {
      return (
        <NumberInput
          id={`${id}-main`}
          field={field}
          label={field.label}
          value={currentOf(field, main.value) as PrimitiveValue}
          onChange={(value) => main.onChange(value as FieldValue)}
        />
      );
    }
    // Sim/não: só o marcador (o rótulo já está no topo do bloco).
    if (field.type === 'boolean') return <Toggle {...main} />;
    // Outros tipos num bloco compacto: o controle normal.
    return <FieldControl {...main} />;
  })();

  return (
    <div className="bg-card flex min-w-0 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-center">
      <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {title}
      </span>
      {body}
      {secondary && <SecondaryValue {...secondary} />}
    </div>
  );
}

/** Campo secundário, pequeno, embaixo do principal. */
export function SecondaryValue({ field, value, derived, onChange }: CompactFieldProps) {
  if (field.type === 'computed') return <BigComputed field={field} derived={derived} size="md" />;
  if (field.type === 'number') {
    return (
      <div className="w-16">
        <NumberInput
          compact
          field={field}
          label={field.label}
          value={currentOf(field, value) as PrimitiveValue}
          onChange={(next) => onChange(next as FieldValue)}
        />
      </div>
    );
  }
  if (field.type === 'list' || field.type === 'resource') return null;
  return (
    <PrimitiveInput
      compact
      field={field}
      label={field.label}
      value={currentOf(field, value) as PrimitiveValue}
      onChange={(next) => onChange(next as FieldValue)}
    />
  );
}

/** Marcador redondo de sim/não (proficiência, preparado…), compacto e com rótulo acessível. */
function Toggle({ field, value, onChange }: CompactFieldProps) {
  const on = currentOf(field, value) === true;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={field.label}
      title={field.label}
      className={cn(
        'shrink-0 rounded-full p-0.5',
        on ? 'text-primary' : 'text-muted-foreground/60 hover:text-muted-foreground',
      )}
      onClick={() => onChange(!on)}
    >
      {on ? <CircleCheckIcon className="size-4" /> : <CircleIcon className="size-4" />}
    </button>
  );
}

/**
 * Uma linha de uma seção em "linhas" (ex.: uma perícia). Os marcadores de sim/não vêm
 * primeiro; o nome da linha é o do campo principal (o último número ou calculado), que
 * fica à direita com o dado de teste; outros campos aparecem compactos no meio.
 */
export function FieldLine({ cells }: { cells: CompactFieldProps[] }) {
  const mainIndex = cells.findLastIndex(
    (cell) => cell.field.type === 'computed' || cell.field.type === 'number',
  );
  const main = mainIndex >= 0 ? cells[mainIndex] : undefined;
  const toggles = cells.filter((cell) => cell.field.type === 'boolean');
  const others = cells.filter(
    (cell, index) => index !== mainIndex && cell.field.type !== 'boolean',
  );
  const name = main?.field.label ?? cells[0]?.field.label ?? '';

  return (
    <div className="flex min-h-9 items-center gap-2 border-b py-1 last:border-b-0">
      {toggles.map((cell) => (
        <Toggle key={cell.field.id} {...cell} />
      ))}
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      {others.map((cell) => (
        <div key={cell.field.id} className={cn(cell.field.type === 'select' ? 'w-36' : 'w-24')}>
          <SecondaryValue {...cell} />
        </div>
      ))}
      {main &&
        (main.field.type === 'computed' ? (
          <BigComputed field={main.field} derived={main.derived} size="md" />
        ) : (
          <SecondaryValue {...main} />
        ))}
    </div>
  );
}
