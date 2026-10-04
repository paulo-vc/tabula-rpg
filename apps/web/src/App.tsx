import { Route, Router, Switch } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import type { Services } from '@/app/services';
import { ServicesProvider } from '@/app/services-context';
import { AppShell } from '@/components/AppShell';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HomePage } from '@/pages/HomePage';
import { SheetPage } from '@/pages/SheetPage';
import { SystemsPage } from '@/pages/SystemsPage';

/**
 * Rotas com hash (`#/fichas/…`): funcionam sem configuração de servidor, tanto no
 * GitHub Pages quanto dentro do app desktop.
 */
export function App({ services }: { services: Services }) {
  return (
    <ServicesProvider services={services}>
      <TooltipProvider>
        <Router hook={useHashLocation}>
          <AppShell>
            <Switch>
              <Route path="/" component={HomePage} />
              <Route path="/sistemas" component={SystemsPage} />
              <Route path="/fichas/:id">
                {(params) => <SheetPage key={params.id} id={params.id} />}
              </Route>
              <Route>
                <p className="text-muted-foreground py-16 text-center">Página não encontrada.</p>
              </Route>
            </Switch>
          </AppShell>
        </Router>
        <Toaster richColors position="bottom-center" />
      </TooltipProvider>
    </ServicesProvider>
  );
}
