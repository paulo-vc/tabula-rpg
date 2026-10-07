import type { ReactNode } from 'react';
import { Link, useRoute } from 'wouter';
import { cn } from '@/lib/utils';
import { LiveSessionIndicator } from './live/LiveSessionIndicator';

/** `also`: outras rotas que pertencem à mesma seção (ex.: uma ficha pertence a "Fichas"). */
function NavLink({ href, also, children }: { href: string; also?: string; children: ReactNode }) {
  const [exact] = useRoute(href);
  const [nested] = useRoute(also ?? href);
  const active = exact || nested;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-md px-2 py-1.5 text-sm font-medium transition-colors sm:px-3',
        active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-foreground min-h-dvh">
      <header className="bg-background/95 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4">
          <Link
            href="/"
            aria-label="Tabula RPG"
            className="flex shrink-0 items-center gap-2 font-semibold"
          >
            <img src="icon.svg" alt="" className="size-6" />
            {/* Em telas estreitas, só o ícone: o menu e o indicador de sessão precisam do espaço. */}
            <span className="hidden sm:inline">Tabula RPG</span>
          </Link>
          <nav aria-label="Principal" className="flex min-w-0 gap-1">
            <NavLink href="/" also="/fichas/*">
              Fichas
            </NavLink>
            <NavLink href="/campanhas" also="/campanhas/*">
              Campanhas
            </NavLink>
            <NavLink href="/sistemas" also="/sistemas/*">
              Sistemas
            </NavLink>
          </nav>
          <LiveSessionIndicator />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
