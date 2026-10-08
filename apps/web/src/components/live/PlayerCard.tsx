import {
  computeDerived,
  defaultValue,
  type CompiledTemplate,
  type EvaluationError,
  type Result,
  type FieldDef,
  type FieldValue,
  type ResourceValue,
} from '@tabula/domain';
import type { HostPlayer } from '@tabula/sync';
import { useMemo } from 'react';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatNumber } from '@/components/sheet/format';

const okValue = (result: Result<number, EvaluationError> | undefined) =>
  result?.ok ? result.value : undefined;

/** Campos mostrados no card: o `gmSummary` do template ou, sem ele, os recursos. */
function summaryFields(compiled: CompiledTemplate): FieldDef[] {
  const ids = compiled.template.layouts.gmSummary;
  if (ids?.length) {
    return ids.map((id) => compiled.fieldsById.get(id)).filter((f): f is FieldDef => Boolean(f));
  }
  return compiled.template.fields.filter((f) => f.type === 'resource').slice(0, 4);
}

function ResourceSummary({
  field,
  value,
  max,
}: {
  field: FieldDef;
  value: ResourceValue;
  max: number | undefined;
}) {
  const percent = max && max > 0 ? Math.max(0, Math.min(100, (value.current / max) * 100)) : 0;
  return (
    <div className="col-span-2 space-y-1">
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
    </div>
  );
}

function valueText(field: FieldDef, value: FieldValue | undefined): string {
  const current = value ?? defaultValue(field);
  switch (field.type) {
    case 'number':
      return typeof current === 'number' ? formatNumber(current) : '—';
    case 'boolean':
      return current === true ? 'Sim' : 'Não';
    case 'select': {
      const selected: string[] = Array.isArray(current)
        ? (current as string[])
        : typeof current === 'string' && current
          ? [current]
          : [];
      const labels = field.options.filter((o) => selected.includes(o.value)).map((o) => o.label);
      return labels.length ? labels.join(', ') : '—';
    }
    case 'list':
      return `${Array.isArray(current) ? current.length : 0} itens`;
    default:
      return typeof current === 'string' && current ? current : '—';
  }
}

/** Card de um jogador no painel do Mestre, atualizado em tempo real. */
export function PlayerCard({
  player,
  compiled,
  campaignId,
}: {
  player: HostPlayer;
  compiled: CompiledTemplate | undefined;
  /** Com a campanha, o card leva à ficha completa (o Mestre pode alterá-la). */
  campaignId?: string;
}) {
  const values = player.sheet?.values;
  const derived = useMemo(
    () => (compiled && values ? computeDerived(compiled, values) : undefined),
    [compiled, values],
  );

  return (
    <Card
      role="article"
      aria-label={`Jogador ${player.displayName}`}
      className={cn(!player.online && 'opacity-70')}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span
            className={cn(
              'size-2.5 rounded-full',
              player.online ? 'bg-emerald-500' : 'bg-zinc-500',
            )}
            aria-hidden
          />
          {player.sheet?.name ?? 'Ficha ainda não recebida'}
        </CardTitle>
        <CardDescription className="flex items-center gap-2">
          {player.displayName}
          <Badge variant={player.online ? 'secondary' : 'outline'}>
            {player.online ? 'Online' : 'Offline'}
          </Badge>
        </CardDescription>
      </CardHeader>
      {compiled && player.sheet && (
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {summaryFields(compiled).map((field) => {
              const value = player.sheet?.values[field.id];
              if (field.type === 'resource') {
                const resource = (value ?? defaultValue(field)) as ResourceValue;
                const max =
                  field.max === undefined ? resource.max : okValue(derived?.resourceMax[field.id]);
                return <ResourceSummary key={field.id} field={field} value={resource} max={max} />;
              }
              const computed =
                field.type === 'computed' ? okValue(derived?.computed[field.id]) : undefined;
              const text =
                field.type === 'computed'
                  ? computed === undefined
                    ? '—'
                    : formatNumber(computed, field.signed)
                  : valueText(field, value);
              const wide = field.type === 'select' && field.multiple;
              return (
                <div key={field.id} className={cn('min-w-0', wide && 'col-span-2')}>
                  <dt className="text-muted-foreground text-xs">{field.label}</dt>
                  <dd className="truncate font-medium" title={text}>
                    {text}
                  </dd>
                </div>
              );
            })}
          </dl>
          {campaignId && (
            <Button variant="outline" size="sm" className="mt-3" asChild>
              <Link href={`/campanhas/${campaignId}/jogadores/${player.sheetId}`}>
                Abrir ficha de {player.sheet.name}
              </Link>
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}
