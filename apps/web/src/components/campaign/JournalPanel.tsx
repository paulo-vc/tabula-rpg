import { JOURNAL_TEXT_LIMIT, type JournalEntry } from '@tabula/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpenIcon, LockIcon, PencilIcon, PlusIcon, Trash2Icon, UsersIcon } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useServices } from '@/app/services-context';
import type { JournalDraft } from '@/app/journal';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

/** Uma entrada: título, data e texto (encurtado até abrir). */
function EntryView({
  entry,
  badge,
  actions,
}: {
  entry: JournalEntry;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const long = entry.text.length > 280 || entry.text.split('\n').length > 4;
  return (
    <li className="space-y-1 rounded-md border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{entry.title}</h3>
        {badge}
        <span className="text-muted-foreground text-xs">{date.format(entry.createdAt)}</span>
        {actions && <div className="ml-auto flex gap-1">{actions}</div>}
      </div>
      {entry.text && (
        <p className={cn('text-sm whitespace-pre-wrap', !open && long && 'line-clamp-4')}>
          {entry.text}
        </p>
      )}
      {long && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Mostrar menos' : 'Ler tudo'}
        </Button>
      )}
    </li>
  );
}

/** Formulário de uma entrada (nova ou existente). */
function EntryDialog({
  entry,
  onClose,
  onSave,
}: {
  entry: JournalEntry | 'nova';
  onClose: () => void;
  onSave: (draft: JournalDraft) => Promise<boolean>;
}) {
  const base = useId();
  const current = entry === 'nova' ? null : entry;
  const [title, setTitle] = useState(current?.title ?? '');
  const [text, setText] = useState(current?.text ?? '');
  const [shared, setShared] = useState(current?.shared ?? true);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (await onSave({ title, text, shared })) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{current ? 'Editar entrada' : 'Nova entrada'}</DialogTitle>
            <DialogDescription>
              Notas ficam só com você. Entradas compartilhadas aparecem para a mesa e chegam aos
              jogadores na sessão.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${base}-titulo`}>Título</Label>
            <Input
              id={`${base}-titulo`}
              value={title}
              maxLength={100}
              placeholder="ex.: Sessão 3 — a mina perdida"
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${base}-texto`}>Texto</Label>
            <Textarea
              id={`${base}-texto`}
              value={text}
              rows={10}
              maxLength={JOURNAL_TEXT_LIMIT}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${base}-compartilhar`}
              checked={shared}
              onCheckedChange={(value) => setShared(value === true)}
            />
            <Label htmlFor={`${base}-compartilhar`} className="font-normal">
              Compartilhar com a mesa
            </Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!title.trim() || busy}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Diário da campanha, do lado do Mestre: notas privadas e entradas para a mesa. */
export function GameMasterJournal({ campaignId }: { campaignId: string }) {
  const { journal } = useServices();
  const entries = useLiveQuery(() => journal.list(campaignId), [journal, campaignId]);
  const [editing, setEditing] = useState<JournalEntry | 'nova' | null>(null);
  const [removing, setRemoving] = useState<JournalEntry | null>(null);

  const save = async (draft: JournalDraft) => {
    const result =
      editing && editing !== 'nova'
        ? await journal.update(campaignId, editing.id, draft)
        : await journal.create(campaignId, draft);
    if (!result.ok) toast.error('Não foi possível salvar', { description: result.error.message });
    return result.ok;
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <BookOpenIcon className="size-4" />
          <h2>Diário e notas</h2>
          <Button size="sm" className="ml-auto" onClick={() => setEditing('nova')}>
            <PlusIcon /> Nova entrada
          </Button>
        </CardTitle>
        <CardDescription>
          Resumos das sessões para a mesa e anotações só suas. As entradas compartilhadas chegam aos
          jogadores quando a sessão está aberta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries?.length === 0 && (
          <p className="text-muted-foreground text-sm">Nenhuma entrada ainda.</p>
        )}
        <ul className="space-y-2" aria-label="Entradas do diário">
          {entries?.map((entry) => (
            <EntryView
              key={entry.id}
              entry={entry}
              badge={
                entry.shared ? (
                  <Badge variant="secondary">
                    <UsersIcon /> Compartilhada
                  </Badge>
                ) : (
                  <Badge variant="outline">
                    <LockIcon /> Só você
                  </Badge>
                )
              }
              actions={
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Editar ${entry.title}`}
                    onClick={() => setEditing(entry)}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Apagar ${entry.title}`}
                    onClick={() => setRemoving(entry)}
                  >
                    <Trash2Icon />
                  </Button>
                </>
              }
            />
          ))}
        </ul>
      </CardContent>

      {editing && (
        <EntryDialog
          key={editing === 'nova' ? 'nova' : editing.id}
          entry={editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar "{removing?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.shared
                ? 'A entrada sai do diário da mesa também (na próxima sessão para quem estiver offline).'
                : 'A nota é apagada deste aparelho.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removing) void journal.delete(campaignId, removing.id);
                setRemoving(null);
              }}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Diário da campanha, do lado do jogador: o que o Mestre compartilhou. */
export function PlayerJournal({ campaignId }: { campaignId: string }) {
  const { journal } = useServices();
  const entries = useLiveQuery(() => journal.list(campaignId), [journal, campaignId]);
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpenIcon className="size-4" />
          <h2>Diário da campanha</h2>
        </CardTitle>
        <CardDescription>
          O que o Mestre compartilhou. Fica neste aparelho, para ler mesmo fora da sessão.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries?.length === 0 ? (
          <p className="text-muted-foreground text-sm">O Mestre ainda não compartilhou nada.</p>
        ) : (
          <ul className="space-y-2" aria-label="Entradas do diário">
            {entries?.map((entry) => (
              <EntryView key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
