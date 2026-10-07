import { contentChanged } from '@tabula/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  Redo2Icon,
  SaveIcon,
  Trash2Icon,
  Undo2Icon,
  UploadIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Link, useLocation } from 'wouter';
import { useServices } from '@/app/services-context';
import { EditorPreview } from '@/components/editor/EditorPreview';
import { FieldDialog } from '@/components/editor/FieldDialog';
import { InfoEditor } from '@/components/editor/InfoEditor';
import { describeIssue } from '@/components/editor/issues';
import { StructureEditor } from '@/components/editor/StructureEditor';
import { useTemplateEditor } from '@/components/editor/use-template-editor';
import { PublishDialog } from '@/components/PublishDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Tab = 'estrutura' | 'informacoes' | 'previa';

const TABS: { id: Tab; label: string; className?: string }[] = [
  { id: 'estrutura', label: 'Campos e seções' },
  { id: 'informacoes', label: 'Informações' },
  // Em telas largas a prévia fica sempre ao lado.
  { id: 'previa', label: 'Prévia', className: 'lg:hidden' },
];

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function EditorPage({ id }: { id: string }) {
  const { editor, catalog } = useServices();
  const [, navigate] = useLocation();
  const { state, template, validation, preview, apply, undo, redo, canUndo, canRedo, flush } =
    useTemplateEditor(id);
  const [tab, setTab] = useState<Tab>('estrutura');
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const draft = state.status === 'pronto' ? state.draft : undefined;
  const saved = useLiveQuery(
    async () => (draft?.editing ? catalog.get(draft.editing) : undefined),
    [catalog, draft?.editing],
  );

  // Ctrl+Z / Ctrl+Shift+Z fora dos campos de texto (que têm o próprio desfazer).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) undo();
      else if (key === 'y' || (key === 'z' && event.shiftKey)) redo();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  if (state.status === 'carregando') return null;
  if (state.status === 'inexistente' || !template || !validation) {
    return (
      <div className="space-y-3 py-16 text-center">
        <p className="text-muted-foreground">Este rascunho não existe mais.</p>
        <Link href="/sistemas" className="underline">
          Voltar aos sistemas
        </Link>
      </div>
    );
  }

  const problemCount = validation.issues.length;

  const save = async () => {
    setSaving(true);
    try {
      await flush();
      const result = await editor.save(id);
      if (result.ok) {
        toast.success(`"${result.template.name}" salvo`, {
          description: `Versão ${result.template.version}`,
        });
        navigate('/sistemas');
      } else {
        const [first] = result.issues;
        toast.error('O sistema tem problemas', {
          description: first ? describeIssue(template, first) : undefined,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/sistemas"
          aria-label="Voltar aos sistemas"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold tracking-tight">
          {template.name || 'Sistema sem nome'}
        </h1>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Desfazer"
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2Icon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refazer"
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2Icon />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Descartar rascunho">
                <Trash2Icon />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Descartar o rascunho?</AlertDialogTitle>
                <AlertDialogDescription>
                  {draft?.editing
                    ? 'As alterações não salvas serão perdidas. O sistema salvo continua como está.'
                    : 'O sistema ainda não foi salvo e será perdido.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={async () => {
                    await editor.discard(id);
                    navigate('/sistemas');
                  }}
                >
                  Descartar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {saved && (
            <Button
              variant="outline"
              disabled={contentChanged(saved, template)}
              title={
                contentChanged(saved, template)
                  ? 'Salve as alterações antes de publicar'
                  : 'Publicar na comunidade'
              }
              onClick={() => setPublishing(true)}
            >
              <UploadIcon /> Publicar
            </Button>
          )}
          <Button onClick={save} disabled={saving || problemCount > 0}>
            <SaveIcon /> Salvar sistema
          </Button>
        </div>
      </div>

      {problemCount > 0 ? (
        <p className="text-destructive flex items-center gap-1.5 text-sm" role="status">
          <CircleAlertIcon className="size-4" />
          {problemCount === 1 ? '1 problema' : `${problemCount} problemas`} para corrigir antes de
          salvar. Os campos com problema estão marcados.
        </p>
      ) : (
        <p className="text-muted-foreground text-sm" role="status">
          Rascunho salvo automaticamente neste aparelho.
        </p>
      )}

      <div role="tablist" aria-label="Partes do editor" className="flex gap-1 border-b">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={tab === item.id}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
              tab === item.id
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent',
              item.className,
            )}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'estrutura' && problemCount > 0 && (
              <Badge variant="destructive" className="ml-2">
                {problemCount}
              </Badge>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={cn('min-w-0 space-y-4', tab === 'previa' && 'hidden lg:block')}>
          {validation.general.length > 0 && (
            <ul className="border-destructive/40 bg-destructive/5 text-destructive space-y-1 rounded-md border p-3 text-sm">
              {validation.general.map((issue, index) => (
                <li key={index}>{describeIssue(template, issue)}</li>
              ))}
            </ul>
          )}
          {tab === 'informacoes' ? (
            <InfoEditor
              template={template}
              apply={apply}
              idEditable={!draft?.editing}
              savedVersion={saved?.version}
            />
          ) : (
            <StructureEditor
              template={template}
              issues={validation.byField}
              apply={apply}
              onEditField={setEditing}
            />
          )}
        </div>
        <section
          aria-label="Prévia da ficha"
          className={cn('min-w-0', tab !== 'previa' && 'hidden lg:block')}
        >
          <h2 className="text-muted-foreground mb-2 hidden text-sm font-medium lg:block">Prévia</h2>
          {preview ? (
            <EditorPreview compiled={preview} stale={validation.compiled === null} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Corrija os problemas para ver a prévia da ficha.
            </p>
          )}
        </section>
      </div>

      <PublishDialog
        template={publishing && saved ? saved : null}
        onClose={() => setPublishing(false)}
      />

      <FieldDialog
        template={template}
        fieldId={editing}
        onApply={apply}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
