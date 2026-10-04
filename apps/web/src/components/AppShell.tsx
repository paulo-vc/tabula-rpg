import type { ReactNode } from 'react';
import { Link, useRoute } from 'wouter';
import { cn } from '@/lib/utils';

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
        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
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
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <img src="icon.svg" alt="" className="size-6" />
            Tabula RPG
          </Link>
          <nav aria-label="Principal" className="flex gap-1">
            <NavLink href="/" also="/fichas/*">
              Fichas
            </NavLink>
            <NavLink href="/sistemas">Sistemas</NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
