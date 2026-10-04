import { computeDerived, type FieldValue, type SheetValues } from '@tabula/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeftIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Link, useLocation } from 'wouter';
import type { OpenedSheet } from '@/app/sheets';
import { useServices } from '@/app/services-context';
import { SheetLayout } from '@/components/sheet/SheetLayout';
import { useDraft } from '@/components/sheet/use-draft';
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

  const { values, derived, onChange } = useSheetEditing(id, compiled, sheet?.values);

  const name = useDraft(
    sheet?.name ?? '',
    (next: string) => {
      if (next.trim()) void services.sheets.rename(id, next);
    },
    SAVE_DELAY,
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

      <SheetLayout
        compiled={compiled}
        values={values}
        derived={derived}
        onChange={onChange}
        newItemId={() => crypto.randomUUID()}
      />

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

/** Pausa (ms) antes de gravar: digitar "16" grava uma vez, não duas. */
const SAVE_DELAY = 400;

/**
 * Edição otimista da ficha: o valor aparece e os cálculos se atualizam na hora; a gravação
 * acontece após uma pausa, por campo. Cliques rápidos (ex.: "+" no HP) partem sempre do
 * valor mais recente. Gravações pendentes são feitas ao sair da página ou esconder a aba.
 */
function useSheetEditing(
  id: string,
  compiled: OpenedReady['compiled'],
  stored: SheetValues | undefined,
) {
  const services = useServices();
  const [pending, setPending] = useState<Record<string, FieldValue>>({});
  const values = useMemo(() => ({ ...stored, ...pending }), [stored, pending]);
  const derived = useMemo(() => computeDerived(compiled, values), [compiled, values]);

  const queue = useRef(new Map<string, FieldValue>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const save = useCallback(
    (fieldId: string) => {
      clearTimeout(timers.current.get(fieldId));
      timers.current.delete(fieldId);
      if (!queue.current.has(fieldId)) return;
      const value = queue.current.get(fieldId) as FieldValue;
      queue.current.delete(fieldId);
      services.sheets.setValue(id, fieldId, value).then(
        () =>
          setPending((current) => {
            if (current[fieldId] !== value) return current; // já há um valor mais novo
            const { [fieldId]: _saved, ...rest } = current;
            return rest;
          }),
        (error: unknown) => toast.error('Não foi possível salvar', { description: String(error) }),
      );
    },
    [services, id],
  );

  useEffect(() => {
    const saveAll = () => [...queue.current.keys()].forEach(save);
    const onHide = () => document.visibilityState === 'hidden' && saveAll();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', saveAll);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', saveAll);
      saveAll(); // ao sair da página da ficha
    };
  }, [save]);

  const onChange = useCallback(
    (fieldId: string, value: FieldValue) => {
      setPending((current) => ({ ...current, [fieldId]: value }));
      queue.current.set(fieldId, value);
      clearTimeout(timers.current.get(fieldId));
      timers.current.set(
        fieldId,
        setTimeout(() => save(fieldId), SAVE_DELAY),
      );
    },
    [save],
  );

  return { values, derived, onChange };
}
