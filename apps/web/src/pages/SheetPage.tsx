import type { FieldValue } from '@tabula/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeftIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Link, useLocation } from 'wouter';
import type { OpenedSheet } from '@/app/sheets';
import { useServices } from '@/app/services-context';
import { SheetLayout } from '@/components/sheet/SheetLayout';
import { SheetVitals } from '@/components/sheet/SheetVitals';
import { useDraft } from '@/components/sheet/use-draft';
import { useSheetEditing } from '@/components/sheet/use-sheet-editing';
import { RollContext } from '@/components/sheet/roll-context';
import { useRoller } from '@/components/live/use-roller';
import { useDeviceId } from '@/components/use-device';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { downloadFile } from '@/lib/browser-files';

export function SheetPage({ id }: { id: string }) {
  const services = useServices();
  const [opened, setOpened] = useState<OpenedSheet | null>(null);

  // Abrir reconcilia a ficha com o template (pode migrar e gravar), por isso fica fora da
  // consulta reativa, que precisa ser somente leitura.
  const reopen = useCallback(() => {
    services.sheets.open(id).then(setOpened, (error: unknown) => {
      toast.error('Erro ao abrir a ficha', { description: String(error) });
    });
  }, [services, id]);
  useEffect(reopen, [reopen]);

  if (!opened) return null;
  switch (opened.status) {
    case 'nao-encontrada':
      return <Message title="Ficha não encontrada" text="Ela pode ter sido excluída." />;
    case 'template-ausente':
      return (
        <Message
          title="Sistema não instalado"
          text={`Esta ficha usa o sistema "${opened.sheet.templateRef.id}", que não está instalado. Importe o sistema para abri-la.`}
        />
      );
    case 'atualizacao-pendente':
      return (
        <Message
          title="Atualização do sistema"
          text={`O sistema "${opened.compiled.template.name}" mudou para a versão ${opened.compiled.template.version}, com mudanças grandes. Campos removidos ficam guardados na ficha e voltam se o campo voltar a existir.`}
        >
          <Button
            onClick={async () => {
              await services.sheets.migrate(opened.sheet, opened.compiled);
              reopen();
            }}
          >
            Atualizar ficha
          </Button>
        </Message>
      );
    case 'pronta':
      return <SheetEditor id={id} compiled={opened.compiled} />;
  }
}

function Message({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
      <TriangleAlertIcon className="text-muted-foreground mx-auto size-10" />
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{text}</p>
      <div className="flex justify-center gap-2">
        <Button variant="outline" asChild>
          <Link href="/">Voltar às fichas</Link>
        </Button>
        {children}
      </div>
    </div>
  );
}

function SheetEditor({ id, compiled }: { id: string; compiled: OpenedReady['compiled'] }) {
  const services = useServices();
  const [, navigate] = useLocation();
  const sheet = useLiveQuery(() => services.sheetRepository.get(id), [services, id]);

  const persist = useCallback(
    (fieldId: string, value: FieldValue) => services.sheets.setValue(id, fieldId, value),
    [services, id],
  );
  const { values, derived, onChange } = useSheetEditing(compiled, sheet?.values, persist);
  const roller = useRoller(compiled);
  // Ficha de jogador numa campanha: os campos secretos são do Mestre. Escondidos também
  // enquanto a consulta carrega, para não piscarem na tela.
  const deviceId = useDeviceId();
  const isPlayerSheet = useLiveQuery(
    async () => (deviceId ? services.campaigns.isPlayerSheet(id, deviceId) : undefined),
    [services, id, deviceId],
  );
  const hidden = useMemo(
    () =>
      isPlayerSheet !== false
        ? new Set(compiled.template.fields.filter((f) => f.visibility === 'gm').map((f) => f.id))
        : undefined,
    [isPlayerSheet, compiled],
  );

  const name = useDraft(
    sheet?.name ?? '',
    (next: string) => {
      if (next.trim()) void services.sheets.rename(id, next);
    },
    400,
  );

  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!sheet) return null;
  const { template } = compiled;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/" aria-label="Voltar às fichas">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <Input
          aria-label="Nome da ficha"
          value={name.draft}
          maxLength={100}
          onChange={(event) => name.change(event.target.value)}
          onBlur={() => {
            name.blur();
            if (!name.draft.trim()) name.setDraft(sheet.name);
          }}
          className="h-10 max-w-md flex-1 border-transparent text-xl font-bold shadow-none hover:border-input"
        />
        <Badge variant="secondary">{template.name}</Badge>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Ações da ficha" className="ml-auto">
              <EllipsisVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                downloadFile(services.files.exportSheet({ ...sheet, values }, template))
              }
            >
              <DownloadIcon /> Exportar
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                const copy = await services.sheets.duplicate(id);
                if (copy) navigate(`/fichas/${copy.id}`);
              }}
            >
              <CopyIcon /> Duplicar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
              <Trash2Icon /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <RollContext value={roller}>
        <SheetVitals
          compiled={compiled}
          values={values}
          derived={derived}
          onChange={onChange}
          hiddenFieldIds={hidden}
        />
        <SheetLayout
          compiled={compiled}
          values={values}
          derived={derived}
          onChange={onChange}
          newItemId={() => crypto.randomUUID()}
          {...(hidden && { hiddenFieldIds: hidden })}
        />
      </RollContext>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{sheet.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              A ficha será apagada deste dispositivo. Exporte antes se quiser guardar uma cópia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                await services.sheets.delete(id);
                navigate('/');
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type OpenedReady = Extract<OpenedSheet, { status: 'pronta' }>;
