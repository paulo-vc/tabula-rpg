import { MAX_MARKS } from '@tabula/domain';
import { cn } from '@/lib/utils';

/** Quantos marcadores mostrar, ou `null` se o máximo não cabe (volta ao campo numérico). */
export function markCount(max: number | undefined): number | null {
  if (max === undefined || !Number.isInteger(max) || max < 1 || max > MAX_MARKS) return null;
  return max;
}

/**
 * Marcadores clicáveis, como as bolinhas de uma ficha de papel. Marcar o 3º marca os três
 * primeiros; clicar no último marcado o desmarca (assim dá para voltar a zero).
 */
export function Marks({
  label,
  value,
  count,
  onChange,
  size = 'md',
}: {
  label: string;
  value: number;
  count: number;
  onChange: (value: number) => void;
  size?: 'sm' | 'md';
}) {
  const filled = Math.max(0, Math.min(count, Math.round(value)));
  return (
    <div
      role="group"
      aria-label={`${label}: ${filled} de ${count}`}
      className="flex flex-wrap items-center gap-1"
    >
      {Array.from({ length: count }, (_, index) => {
        const position = index + 1;
        const on = position <= filled;
        return (
          <button
            key={position}
            type="button"
            aria-label={`${label}: ${position}`}
            aria-pressed={on}
            className={cn(
              'focus-visible:ring-ring/50 rounded-full border-2 transition-colors outline-none focus-visible:ring-[3px]',
              size === 'sm' ? 'size-5' : 'size-6',
              on ? 'border-primary bg-primary' : 'border-muted-foreground/40 hover:border-primary',
            )}
            onClick={() => onChange(position === filled ? position - 1 : position)}
          />
        );
      })}
    </div>
  );
}
