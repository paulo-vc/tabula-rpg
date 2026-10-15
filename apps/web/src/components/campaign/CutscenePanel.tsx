import type { StoredImage } from '@tabula/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import { EyeIcon, EyeOffIcon, ImageIcon, ImagePlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useServices } from '@/app/services-context';
import { useImageUrl } from '@/components/live/CutsceneOverlay';
import { useLiveSession } from '@/components/live/use-live-session';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

const ACCEPT = 'image/png,image/jpeg,image/webp';

/** Nome do arquivo sem a extensão, como sugestão de título. */
const baseName = (name: string) => name.replace(/\.[^.]+$/, '').slice(0, 100);

/** Dados da imagem escolhida: título, legenda e prévia, antes de guardar. */
function AddImageDialog({
  file,
  onClose,
  onAdd,
}: {
  file: File;
  onClose: () => void;
  onAdd: (input: { title: string; caption: string }) => Promise<boolean>;
}) {
  const base = useId();
  const [title, setTitle] = useState(baseName(file.name));
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(preview), [preview]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (await onAdd({ title, caption })) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Adicionar imagem</DialogTitle>
            <DialogDescription>
              A imagem é reduzida neste aparelho e fica na galeria da campanha. Os jogadores só a
              recebem quando você a mostra.
            </DialogDescription>
          </DialogHeader>
          <img src={preview} alt="" className="max-h-56 w-full rounded-md object-contain" />
          <div className="space-y-1.5">
            <Label htmlFor={`${base}-titulo`}>Nome</Label>
            <Input
              id={`${base}-titulo`}
              value={title}
              maxLength={100}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${base}-legenda`}>Legenda (opcional)</Label>
            <Textarea
              id={`${base}-legenda`}
              value={caption}
              rows={2}
              maxLength={500}
              onChange={(event) => setCaption(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!title.trim() || busy}>
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Thumbnail({ campaignId, image }: { campaignId: string; image: StoredImage }) {
  const { gallery } = useServices();
  const url = useImageUrl(() => gallery.get(campaignId, image.id), [gallery, campaignId, image.id]);
  return url ? (
    <img src={url} alt="" className="aspect-video w-full rounded-md bg-black object-contain" />
  ) : (
    <div className="bg-muted flex aspect-video w-full items-center justify-center rounded-md">
      <ImageIcon className="text-muted-foreground size-6" />
    </div>
  );
}

/**
 * Cutscene, do lado do Mestre: a galeria de imagens da campanha e o botão de mostrar à mesa
 * (em tela cheia, para todos os jogadores da sessão).
 */
export function CutscenePanel({ campaignId }: { campaignId: string }) {
  const { gallery, session } = useServices();
  const live = useLiveSession();
  const images = useLiveQuery(() => gallery.list(campaignId), [gallery, campaignId]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [removing, setRemoving] = useState<StoredImage | null>(null);
  const inSession = live.kind === 'mestre' && live.campaignId === campaignId;
  const showing = inSession ? live.cutscene : null;

  const add = async (input: { title: string; caption: string }) => {
    if (!file) return false;
    const result = await gallery.add(campaignId, file, input);
    if (!result.ok)
      toast.error('Não foi possível adicionar', { description: result.error.message });
    return result.ok;
  };
  const show = async (image: StoredImage) => {
    const result = await session.showCutscene(campaignId, image.id);
    if (!result.ok) toast.error('Não foi possível mostrar', { description: result.error.message });
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <ImageIcon className="size-4" />
          <h2>Cutscene</h2>
          <Button size="sm" className="ml-auto" onClick={() => fileInput.current?.click()}>
            <ImagePlusIcon /> Adicionar imagem
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            className="hidden"
            aria-label="Escolher imagem"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              event.target.value = '';
            }}
          />
        </CardTitle>
        <CardDescription>
          Prepare imagens de NPCs, criaturas e cenários e mostre-as em tela cheia para a mesa
          {inSession ? '.' : ' (com a sessão aberta).'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {showing && (
          <div
            role="status"
            className="border-primary bg-primary/10 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <EyeIcon className="size-4" />
            Mostrando à mesa: <strong>{showing.title || 'imagem sem nome'}</strong>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => session.hideCutscene(campaignId)}
            >
              <EyeOffIcon /> Parar de mostrar
            </Button>
          </div>
        )}
        {images?.length === 0 && (
          <p className="text-muted-foreground text-sm">Nenhuma imagem na galeria ainda.</p>
        )}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Galeria">
          {images?.map((image) => (
            <li key={image.id} className="space-y-1.5">
              <Thumbnail campaignId={campaignId} image={image} />
              <p className="truncate text-sm font-medium" title={image.title}>
                {image.title}
              </p>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={showing?.hash === image.hash ? 'default' : 'outline'}
                  className="flex-1"
                  disabled={!inSession}
                  title={inSession ? undefined : 'Abra a sessão para mostrar à mesa'}
                  aria-label={`Mostrar ${image.title} à mesa`}
                  onClick={() => void show(image)}
                >
                  <EyeIcon /> Mostrar
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Apagar ${image.title}`}
                  onClick={() => setRemoving(image)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>

      {file && <AddImageDialog file={file} onClose={() => setFile(null)} onAdd={add} />}
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar "{removing?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              A imagem sai da galeria deste aparelho. Quem já a recebeu continua com a cópia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removing) void gallery.delete(campaignId, removing.id);
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
