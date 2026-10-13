import type { Campaign } from '@tabula/domain';
import type { ClientStatus } from '@tabula/sync';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  LoaderCircleIcon,
  PlayIcon,
  RadioIcon,
  SquareIcon,
  TriangleAlertIcon,
  UsersIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { describeConnection, describeDuration, useNow } from './connection';
import { PlayerCard } from './PlayerCard';
import { useLiveSession } from './use-live-session';

/** Mensagem para quando a conexão direta falha (sem relay, ADR 0008). */
const DIRECT_FAILURE =
  'A conexão direta não abriu. Isso costuma acontecer em redes de empresa ou escola, ou quando os dois lados estão no 4G. Tentem outra rede (por exemplo, Wi-Fi de casa).';

function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

/** Painel do Mestre: abre a sessão e mostra os jogadores ao vivo. */
export function GameMasterSession({ campaign }: { campaign: Campaign }) {
  const { session, catalog } = useServices();
  const live = useLiveSession();
  const [busy, run] = useBusy();
  const active = live.kind === 'mestre' && live.campaignId === campaign.id;
  const template = useLiveQuery(
    () => catalog.get(campaign.templateRef.id),
    [catalog, campaign.templateRef.id],
  );
  const compiled = useMemo(
    () => (template ? catalog.compile(template) : undefined),
    [catalog, template],
  );

  const start = () =>
    run(async () => {
      const result = await session.startAsGameMaster(campaign.id);
      if (!result.ok)
        toast.error('Não foi possível iniciar a sessão', { description: result.error.message });
    });

  const players = active ? live.players : [];
  const online = players.filter((p) => p.online).length;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3">
          <h2>Sessão</h2>
          {active ? (
            <>
              <span className="flex items-center gap-1.5 text-sm font-normal text-emerald-500">
                <RadioIcon className="size-4" /> Ao vivo · {online} online
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={busy}
                onClick={() => run(() => session.stop())}
              >
                <SquareIcon /> Encerrar sessão
              </Button>
            </>
          ) : (
            <Button size="sm" className="ml-auto" disabled={busy} onClick={start}>
              <PlayIcon /> Iniciar sessão
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          {active
            ? 'Mantenha esta janela aberta durante o jogo. As fichas dos jogadores atualizam em tempo real.'
            : 'Inicie a sessão quando o jogo começar. Os jogadores entram pela campanha deles.'}
        </CardDescription>
      </CardHeader>
      {active && (
        <CardContent className="space-y-4">
          {live.connectionFailures > 0 && (
            <p role="alert" className="flex gap-2 text-sm text-amber-600 dark:text-amber-400">
              <TriangleAlertIcon className="size-4 shrink-0" />
              {live.connectionFailures === 1
                ? 'Um jogador não conseguiu se conectar.'
                : `${live.connectionFailures} tentativas de conexão falharam.`}{' '}
              {DIRECT_FAILURE}
            </p>
          )}
          {players.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-6 text-center text-sm">
              <UsersIcon className="size-8" />
              Aguardando jogadores. Eles aparecem aqui ao entrar na sessão.
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {players.map((player) => (
                <li key={player.sheetId}>
                  <PlayerCard
                    player={player}
                    compiled={compiled}
                    campaignId={campaign.id}
                    connection={active ? live.connections[player.sheetId] : undefined}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  );
}

const PLAYER_STATUS: Record<ClientStatus['state'], string> = {
  'procurando-mestre': 'Procurando o Mestre… Ele precisa estar com a sessão aberta.',
  sincronizando: 'Mestre encontrado. Sincronizando sua ficha…',
  conectado: 'Conectado. Suas alterações aparecem para o Mestre em tempo real.',
  recusado: 'O Mestre recusou a entrada.',
};

/** Entrada do jogador na sessão. */
export function PlayerSession({ campaign, hasSheet }: { campaign: Campaign; hasSheet: boolean }) {
  const { session } = useServices();
  const live = useLiveSession();
  const [busy, run] = useBusy();
  const active = live.kind === 'jogador' && live.campaignId === campaign.id;

  const join = () =>
    run(async () => {
      const result = await session.joinAsPlayer(campaign.id);
      if (!result.ok)
        toast.error('Não foi possível entrar na sessão', { description: result.error.message });
    });

  const status = active ? live.status : null;
  const failed = active && live.status.state === 'procurando-mestre' && live.connectionFailures > 0;
  const searchingSince = active ? live.searchingSince : null;
  const now = useNow(searchingSince !== null);
  // Progresso: quanto tempo procurando; ao conectar, quanto levou e como ficou a conexão.
  const progress =
    !active || !status
      ? null
      : searchingSince !== null && status.state !== 'recusado'
        ? `(${describeDuration(Math.max(0, now - searchingSince))})`
        : status.state === 'conectado'
          ? [
              live.connectedInMs !== null && `Conectou em ${describeDuration(live.connectedInMs)}`,
              live.connection && describeConnection(live.connection),
            ]
              .filter(Boolean)
              .join(' · ')
          : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3">
          <h2>Sessão</h2>
          {active ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={busy}
              onClick={() => run(() => session.stop())}
            >
              <SquareIcon /> Sair da sessão
            </Button>
          ) : (
            <Button size="sm" className="ml-auto" disabled={busy || !hasSheet} onClick={join}>
              <PlayIcon /> Entrar na sessão
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          {hasSheet
            ? `Quando ${campaign.gmName} abrir a sessão, entre para compartilhar sua ficha.`
            : 'Escolha ou crie sua ficha para entrar na sessão.'}
        </CardDescription>
      </CardHeader>
      {status && (
        <CardContent>
          <p
            role="status"
            className={cn(
              'flex items-start gap-2 text-sm',
              status.state === 'conectado' && 'text-emerald-600 dark:text-emerald-400',
              (status.state === 'recusado' || failed) && 'text-amber-600 dark:text-amber-400',
            )}
          >
            {status.state === 'procurando-mestre' || status.state === 'sincronizando' ? (
              <LoaderCircleIcon className="size-4 shrink-0 animate-spin" />
            ) : status.state === 'conectado' ? (
              <RadioIcon className="size-4 shrink-0" />
            ) : (
              <TriangleAlertIcon className="size-4 shrink-0" />
            )}
            <span>
              {status.state === 'recusado'
                ? `${PLAYER_STATUS.recusado} ${status.reason.message}`
                : PLAYER_STATUS[status.state]}
              {failed && ` ${DIRECT_FAILURE}`}
              {progress && <span className="text-muted-foreground"> {progress}</span>}
            </span>
          </p>
          {active && live.impersonations > 0 && live.status.state !== 'conectado' && (
            <p
              role="alert"
              className="mt-2 flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                Alguém tentou se passar por {campaign.gmName} sem provar a identidade e foi
                ignorado. Confira o convite com o Mestre.
              </span>
            </p>
          )}
          {active && live.gmIdentity === 'declarada' && (
            <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                Não foi possível verificar a identidade de {campaign.gmName}: o app do Mestre é de
                uma versão antiga do Tabularium RPG. Peça para atualizar.
              </span>
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
