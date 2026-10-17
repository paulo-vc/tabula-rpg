import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Classes da aba (ex.: só em telas estreitas). */
  className?: string;
}

/**
 * Barra de abas acessível (setas trocam de aba). O painel da aba ativa fica a cargo de quem
 * usa a barra.
 */
export function TabBar<T extends string>({
  label,
  tabs,
  active,
  onChange,
}: {
  label: string;
  tabs: readonly TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
}) {
  const base = useId();
  const index = tabs.findIndex((tab) => tab.id === active);
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-1 overflow-x-auto overflow-y-hidden border-b"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(index + step + tabs.length) % tabs.length];
        if (!next) return;
        onChange(next.id);
        document.getElementById(`${base}-${next.id}`)?.focus();
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`${base}-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          tabIndex={tab.id === active ? 0 : -1}
          className={cn(
            '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
            tab.id === active
              ? 'border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground border-transparent',
            tab.className,
          )}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
