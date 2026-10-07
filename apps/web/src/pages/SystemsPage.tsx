import type { SystemTemplate } from '@tabula/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import { DownloadIcon, FileUpIcon, GlobeIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'wouter';
import { useServices } from '@/app/services-context';
import { PublishDialog } from '@/components/PublishDialog';
import { useImport } from '@/components/use-import';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { downloadFile } from '@/lib/browser-files';

const SOURCE_LABEL: Record<SystemTemplate['source'], string> = {
  builtin: 'Nativo',
  community: 'Comunidade',
  local: 'Local',
};

export function SystemsPage() {
  const { catalog, files, sheetRepository } = useServices();
  const templates = useLiveQuery(() => catalog.list(), [catalog]);
  const importFile = useImport();
  const [toDelete, setToDelete] = useState<{ template: SystemTemplate; inUse: number } | null>(
    null,
  );
  const [toPublish, setToPublish] = useState<SystemTemplate | null>(null);
  const updates = useUpdates(templates);

  const askDelete = async (template: SystemTemplate) => {
    const inUse = (await sheetRepository.listByTemplate(template.id)).length;
    setToDelete({ template, inUse });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Sistemas</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={importFile}>
            <FileUpIcon /> Importar sistema
          </Button>
          <Button asChild>
            <Link href="/sistemas/comunidade">
              <GlobeIcon /> Explorar comunidade
            </Link>
          </Button>
        </div>
      </div>

      <ul className="grid gap-3 md:grid-cols-2">
        {templates?.map((template) => (
          <li key={template.id}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle>{template.name}</CardTitle>
                <CardDescription>
                  Versão {template.version}
                  {template.author && ` · ${template.author}`}
                  {template.license && ` · ${template.license}`}
                </CardDescription>
                <CardAction className="flex gap-1">
                  {updates.has(template.id) && (
                    <Badge asChild>
                      <Link href="/sistemas/comunidade">Versão {updates.get(template.id)}</Link>
                    </Badge>
                  )}
                  <Badge variant="secondary">{SOURCE_LABEL[template.source]}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-3">
                {template.description && (
                  <p
                    className="text-muted-foreground line-clamp-4 text-sm wrap-anywhere"
                    title={template.description}
                  >
                    {template.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadFile(files.exportTemplate(template))}
                  >
                    <DownloadIcon /> Exportar
                  </Button>
                  {template.source === 'local' && (
                    <Button variant="outline" size="sm" onClick={() => setToPublish(template)}>
                      <UploadIcon /> Publicar
                    </Button>
                  )}
                  {template.source !== 'builtin' && (
                    <Button variant="ghost" size="sm" onClick={() => askDelete(template)}>
                      <Trash2Icon /> Remover
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <PublishDialog template={toPublish} onClose={() => setToPublish(null)} />

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover "{toDelete?.template.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.inUse
                ? `${toDelete.inUse} ficha(s) usam este sistema e não abrirão até que ele seja importado de novo. As fichas não são apagadas.`
                : 'Nenhuma ficha usa este sistema.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!toDelete) return;
                await catalog.remove(toDelete.template.id);
                toast.success(`Sistema "${toDelete.template.name}" removido`);
                setToDelete(null);
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Versões novas dos sistemas da comunidade instalados. Consulta o catálogo em segundo
 * plano; sem internet, simplesmente não mostra nada.
 */
function useUpdates(templates: SystemTemplate[] | undefined): Map<string, string> {
  const { registry } = useServices();
  const [updates, setUpdates] = useState(new Map<string, string>());
  const hasCommunity = templates?.some((template) => template.source === 'community') ?? false;

  useEffect(() => {
    if (!hasCommunity) return;
    let active = true;
    registry
      .loadIndex()
      .then((index) => registry.updates(index))
      .then((found) => active && setUpdates(found))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [registry, hasCommunity, templates]);

  return updates;
}
