import { RadioIcon } from 'lucide-react';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';
import { useLiveSession } from './use-live-session';

/** Indicador no cabeçalho: a sessão ao vivo continua ativa em qualquer tela. */
export function LiveSessionIndicator() {
  const live = useLiveSession();
  if (live.kind === 'nenhuma') return null;

  const connected = live.kind === 'mestre' || live.status.state === 'conectado';
  const online = live.kind === 'mestre' ? live.players.filter((p) => p.online).length : 0;
  const label =
    live.kind === 'mestre'
      ? `Sessão ao vivo · ${online} online`
      : connected
        ? 'Na sessão'
        : 'Conectando à sessão…';
  // Versão curta para telas estreitas (o rótulo completo continua acessível).
  const short = live.kind === 'mestre' ? `${online}` : connected ? 'Ao vivo' : '…';

  return (
    <Link
      href={`/campanhas/${live.campaignId}`}
      aria-label={label}
      title={label}
      className={cn(
        'ml-auto flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        connected
          ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
          : 'border-amber-500/40 text-amber-600 dark:text-amber-400',
      )}
    >
      <RadioIcon className={cn('size-3.5', !connected && 'animate-pulse')} />
      <span className="hidden md:inline">{label}</span>
      <span className="md:hidden">{short}</span>
    </Link>
  );
}
