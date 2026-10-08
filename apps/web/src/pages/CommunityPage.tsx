import { latestVersion, type RegistryEntry } from '@tabula/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeftIcon, CheckIcon, DownloadIcon, RefreshCwIcon, SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'wouter';
import type { EntryStatus } from '@/app/registry';
import { useServices } from '@/app/services-context';
import { useRegistryIndex } from '@/components/use-registry-index';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function CommunityPage() {
  const { registry, catalog } = useServices();
  const { state, reload } = useRegistryIndex();
  const installed = useLiveQuery(() => catalog.list(), [catalog]);
  const [query, setQuery] = useState('');

  const entries = useMemo(
    () => (state.status === 'pronto' ? registry.search(state.index, query) : []),
    [registry, state, query],
  );
  const installedById = useMemo(
    () => new Map(installed?.map((template) => [template.id, template])),
    [installed],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href="/sistemas"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-4" /> Sistemas
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Sistemas da comunidade</h1>
        <p className="text-muted-foreground text-sm">
          Sistemas feitos por outros jogadores. Depois de instalados, funcionam sem internet.
        </p>
      </div>

      <div className="relative max-w-md">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          type="search"
          aria-label="Buscar sistemas"
          placeholder="Buscar por nome, autor ou etiqueta"
          className="pl-8"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {state.status === 'carregando' && (
        <p className="text-muted-foreground py-12 text-center" role="status">
          Carregando o catálogo…
        </p>
      )}

      {state.status === 'erro' && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <p className="text-muted-foreground max-w-md">{state.message}</p>
          <Button variant="outline" onClick={reload}>
            <RefreshCwIcon /> Tentar de novo
          </Button>
        </div>
      )}

      {state.status === 'pronto' && entries.length === 0 && (
        <p className="text-muted-foreground py-12 text-center">
          {query ? 'Nenhum sistema encontrado.' : 'Ainda não há sistemas publicados.'}
        </p>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {entries.map((entry) => (
          <li key={entry.id}>
            <EntryCard
              entry={entry}
              status={registry.statusOf(entry, installedById.get(entry.id))}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EntryCard({ entry, status }: { entry: RegistryEntry; status: EntryStatus }) {
  const { registry } = useServices();
  const [busy, setBusy] = useState(false);
  const latest = latestVersion(entry);

  const install = async () => {
    setBusy(true);
    try {
      const result = await registry.install(entry);
      if (result.ok) {
        toast.success(
          status.kind === 'atualizacao'
            ? `"${entry.name}" atualizado para ${latest.version}`
            : `Sistema "${entry.name}" instalado`,
        );
      } else {
        toast.error('Não foi possível instalar', { description: result.issues[0]?.message });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{entry.name}</CardTitle>
        <CardDescription>
          Versão {latest.version} · {entry.author} · {entry.license}
        </CardDescription>
        {status.kind === 'atualizacao' && (
          <CardAction>
            <Badge>Atualização</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {entry.description && (
          <p
            className="text-muted-foreground line-clamp-4 text-sm wrap-anywhere"
            title={entry.description}
          >
            {entry.description}
          </p>
        )}
        {entry.tags && entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entry.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <StatusAction status={status} busy={busy} onInstall={install} version={latest.version} />
      </CardContent>
    </Card>
  );
}

function StatusAction({
  status,
  busy,
  version,
  onInstall,
}: {
  status: EntryStatus;
  busy: boolean;
  version: string;
  onInstall: () => void;
}) {
  switch (status.kind) {
    case 'disponivel':
      return (
        <Button size="sm" onClick={onInstall} disabled={busy}>
          <DownloadIcon /> {busy ? 'Instalando…' : 'Instalar'}
        </Button>
      );
    case 'atualizacao':
      return (
        <Button size="sm" onClick={onInstall} disabled={busy}>
          <RefreshCwIcon />{' '}
          {busy ? 'Atualizando…' : `Atualizar de ${status.installed} para ${version}`}
        </Button>
      );
    case 'instalado':
      return (
        <p className="text-muted-foreground flex items-center gap-1 text-sm">
          <CheckIcon className="size-4" /> Instalado
        </p>
      );
    case 'conflito':
      return (
        <p className="text-muted-foreground text-sm">
          Você já tem outro sistema com o mesmo identificador.
        </p>
      );
    case 'requer-app-novo':
      return (
        <p className="text-muted-foreground text-sm">
          Precisa do Tabularium {status.minAppVersion} ou mais novo.
        </p>
      );
  }
}
