import type { Portrait } from '@tabula/domain';
import { ImageIcon, LoaderCircleIcon, Trash2Icon, UserRoundIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Retrato do personagem (ou um ícone, sem retrato). O tamanho vem de `className`. */
export function CharacterPortrait({
  portrait,
  name,
  className,
}: {
  portrait: Portrait | undefined;
  name: string;
  className?: string;
}) {
  const base = 'bg-muted shrink-0 overflow-hidden rounded-full';
  if (!portrait) {
    return (
      <span className={cn(base, 'text-muted-foreground grid place-items-center', className)}>
        <UserRoundIcon className="size-1/2" aria-hidden />
      </span>
    );
  }
  return (
    <img
      src={portrait.src}
      alt={`Retrato de ${name}`}
      width={portrait.width}
      height={portrait.height}
      // Retratos costumam ter o rosto no alto: o corte para o círculo começa por cima.
      className={cn(base, 'object-cover object-top', className)}
    />
  );
}

const ACCEPT = 'image/png,image/jpeg,image/webp';

/** Retrato da ficha com as ações de trocar e remover (para quem edita a ficha). */
export function PortraitPicker({
  sheetId,
  name,
  portrait,
}: {
  sheetId: string;
  name: string;
  portrait: Portrait | undefined;
}) {
  const { sheets } = useServices();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const result = await sheets.setPortrait(sheetId, file);
      if (!result.ok)
        toast.error('Não foi possível usar a imagem', { description: result.error.message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const avatar = busy ? (
    <span className="bg-muted grid size-14 place-items-center rounded-full">
      <LoaderCircleIcon className="size-5 animate-spin" aria-hidden />
    </span>
  ) : (
    <CharacterPortrait portrait={portrait} name={name} className="size-14" />
  );

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        aria-label="Arquivo do retrato"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => void choose(event.target.files?.[0])}
      />
      {portrait ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="size-14 shrink-0 rounded-full p-0"
              aria-label="Retrato do personagem"
              disabled={busy}
            >
              {avatar}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => input.current?.click()}>
              <ImageIcon /> Trocar retrato
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => void sheets.removePortrait(sheetId)}
            >
              <Trash2Icon /> Remover retrato
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="ghost"
          className="size-14 shrink-0 rounded-full p-0"
          aria-label="Escolher retrato"
          title="Escolher retrato"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {avatar}
        </Button>
      )}
    </>
  );
}
