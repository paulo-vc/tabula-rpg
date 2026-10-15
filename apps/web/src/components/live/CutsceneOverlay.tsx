import { useLiveQuery } from 'dexie-react-hooks';
import { LoaderCircleIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import { useLiveSession } from './use-live-session';

/**
 * Endereço local (object URL) de uma imagem guardada neste aparelho, liberado quando a
 * imagem sai da tela. `undefined` enquanto carrega ou se a imagem não está aqui.
 */
export function useImageUrl(
  load: () => Promise<{ data: Uint8Array; meta: { mime: string } } | undefined>,
  deps: unknown[],
): string | undefined {
  const image = useLiveQuery(load, deps);
  const url = useMemo(
    () =>
      image
        ? URL.createObjectURL(
            new Blob([image.data as Uint8Array<ArrayBuffer>], { type: image.meta.mime }),
          )
        : undefined,
    [image],
  );
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

/**
 * Cutscene do lado do jogador: a imagem que o Mestre está mostrando, em tela cheia, por
 * cima de qualquer tela do app. O jogador pode fechar a dele; o Mestre fecha para todos.
 */
export function CutsceneOverlay() {
  const { gallery } = useServices();
  const live = useLiveSession();
  const cutscene = live.kind === 'jogador' ? live.cutscene : null;
  const campaignId = live.kind === 'jogador' ? live.campaignId : '';
  const hash = cutscene?.ready ? cutscene.info.hash : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const url = useImageUrl(
    async () => (hash ? await gallery.byHash(campaignId, hash) : undefined),
    [gallery, campaignId, hash],
  );
  // A dispensa vale para esta exibição: mostrada de novo, a imagem volta.
  const showing = cutscene ? `${cutscene.info.hash}:${cutscene.since}` : null;
  const open = showing !== null && dismissed !== showing;

  useEffect(() => {
    if (!open || !cutscene) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDismissed(showing);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, cutscene, showing]);

  if (!open || !cutscene) return null;
  const { info } = cutscene;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={info.title || 'Imagem do Mestre'}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-white"
    >
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-3 right-3 text-white hover:bg-white/10 hover:text-white"
        autoFocus
        onClick={() => setDismissed(showing)}
      >
        <XIcon /> Fechar
      </Button>
      {url ? (
        <img
          src={url}
          alt={info.caption || info.title}
          width={info.width}
          height={info.height}
          className="max-h-[80vh] w-auto max-w-full rounded-md object-contain shadow-2xl"
        />
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-white/80">
          <LoaderCircleIcon className="size-4 animate-spin" /> Recebendo a imagem do Mestre…
        </p>
      )}
      {info.title && <h2 className="font-brand text-center text-2xl">{info.title}</h2>}
      {info.caption && (
        <p className="max-w-2xl text-center text-sm whitespace-pre-wrap text-white/80">
          {info.caption}
        </p>
      )}
    </div>
  );
}
