import { useLiveQuery } from 'dexie-react-hooks';
import { PlayIcon, Volume2Icon, VolumeXIcon } from 'lucide-react';
import { useId } from 'react';
import { useServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Botão no cabeçalho com as preferências de som deste aparelho. */
export function SoundSettingsButton() {
  const { sounds } = useServices();
  const base = useId();
  const settings = useLiveQuery(() => sounds.settings(), [sounds]);
  const muted = settings ? !settings.enabled || settings.volume === 0 : false;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={muted ? 'Sons desligados' : 'Sons'}
          title="Sons"
        >
          {muted ? <VolumeXIcon /> : <Volume2Icon />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Sons</h2>
          <p className="text-muted-foreground text-xs">
            Avisos curtos na sessão: sua vez no combate, rolagens da mesa, mensagens e sussurros do
            chat.
          </p>
        </div>
        {settings && (
          <>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${base}-ligados`}
                checked={settings.enabled}
                onCheckedChange={(checked) => void sounds.update({ enabled: checked === true })}
              />
              <Label htmlFor={`${base}-ligados`} className="font-normal">
                Tocar sons
              </Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${base}-volume`}>Volume</Label>
              <div className="flex items-center gap-2">
                <input
                  id={`${base}-volume`}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(settings.volume * 100)}
                  disabled={!settings.enabled}
                  className="accent-primary flex-1"
                  onChange={(event) =>
                    void sounds.update({ volume: Number(event.target.value) / 100 })
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void sounds.test()}
                  aria-label="Testar o som"
                >
                  <PlayIcon /> Testar
                </Button>
              </div>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
