import type { Campaign } from '@tabula/domain';
import { ImageIcon, ImagePlusIcon, LoaderCircleIcon, Trash2Icon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';

const ACCEPT = 'image/png,image/jpeg,image/webp';

/** Capa da campanha, em faixa (o corte acompanha a largura da tela). */
export function CampaignCover({
  campaign,
  className = 'h-40 sm:h-56',
  alt,
}: {
  campaign: Campaign;
  /** Texto alternativo (padrão: "Capa de <campanha>"). */
  alt?: string;
  /** Altura da faixa. */
  className?: string | undefined;
}) {
  if (!campaign.cover) return null;
  return (
    <img
      src={campaign.cover.src}
      alt={alt ?? `Capa de ${campaign.name}`}
      width={campaign.cover.width}
      height={campaign.cover.height}
      className={cn('w-full rounded-xl object-cover', className)}
    />
  );
}

/** Capa com as ações do Mestre: adicionar, trocar e remover. */
export function CampaignCoverEditor({ campaign }: { campaign: Campaign }) {
  const { campaigns } = useServices();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const result = await campaigns.setCover(campaign.id, file);
      if (!result.ok) {
        toast.error('Não foi possível usar a imagem', { description: result.error.message });
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const picker = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      aria-label="Arquivo da capa"
      className="sr-only"
      tabIndex={-1}
      onChange={(event) => void choose(event.target.files?.[0])}
    />
  );
  const busyIcon = <LoaderCircleIcon className="animate-spin" />;

  if (!campaign.cover) {
    return (
      <div>
        {picker}
        <Button
          variant="outline"
          size="sm"
          className="border-dashed"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? busyIcon : <ImagePlusIcon />} Adicionar capa
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      {picker}
      <CampaignCover campaign={campaign} alt="Prévia da capa" />
      <div className="absolute right-3 bottom-3 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="shadow"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? busyIcon : <ImageIcon />} Trocar capa
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="shadow"
          disabled={busy}
          aria-label="Remover capa"
          onClick={() => void campaigns.removeCover(campaign.id)}
        >
          <Trash2Icon />
        </Button>
      </div>
    </div>
  );
}
