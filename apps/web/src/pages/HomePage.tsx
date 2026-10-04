import { useLiveQuery } from 'dexie-react-hooks';
import { FileUpIcon, ScrollTextIcon } from 'lucide-react';
import { Link } from 'wouter';
import { useServices } from '@/app/services-context';
import { NewSheetDialog } from '@/components/NewSheetDialog';
import { useImport } from '@/components/use-import';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function HomePage() {
  const { catalog, sheetRepository } = useServices();
  const sheets = useLiveQuery(() => sheetRepository.list(), [sheetRepository]);
  const templates = useLiveQuery(() => catalog.list(), [catalog]);
  const importFile = useImport();
  const templateName = (id: string) => templates?.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Minhas fichas</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={importFile}>
            <FileUpIcon /> Importar
          </Button>
          <NewSheetDialog />
        </div>
      </div>

      {sheets?.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <ScrollTextIcon className="text-muted-foreground size-10" />
          <p className="text-muted-foreground">
            Você ainda não tem fichas. Crie uma nova ou importe um arquivo.
          </p>
        </div>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sheets?.map((sheet) => (
          <li key={sheet.id}>
            <Link href={`/fichas/${sheet.id}`} className="block rounded-xl focus-visible:outline-2">
              <Card className="hover:border-primary/50 h-full transition-colors">
                <CardHeader>
                  <CardTitle>{sheet.name}</CardTitle>
                  <CardDescription>
                    {templateName(sheet.templateRef.id)}
                    <br />
                    Alterada em {dateFormat.format(sheet.updatedAt)}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
