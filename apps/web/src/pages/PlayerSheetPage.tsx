import { defaultValue, type CompiledTemplate, type FieldValue } from '@tabula/domain';
import type { HostPlayer } from '@tabula/sync';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeftIcon, EyeOffIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Link } from 'wouter';
import { useServices } from '@/app/services-context';
import { useLiveSession } from '@/components/live/use-live-session';
import { SheetLayout } from '@/components/sheet/SheetLayout';
import { SheetVitals } from '@/components/sheet/SheetVitals';
import { useSheetEditing } from '@/components/sheet/use-sheet-editing';
import { RollContext } from '@/components/sheet/roll-context';
import { useRoller } from '@/components/live/use-roller';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * O Mestre vê e altera a ficha de um jogador durante a sessão. Campos comuns seguem para
 * o jogador; campos secretos ficam só neste aparelho.
 */
export function PlayerSheetPage({ campaignId, sheetId }: { campaignId: string; sheetId: string }) {
  const { campaignRepository, catalog } = useServices();
  const live = useLiveSession();
  const campaign = useLiveQuery(
    () => campaignRepository.get(campaignId),
    [campaignRepository, campaignId],
  );
  const template = useLiveQuery(
    async () => (campaign ? catalog.get(campaign.templateRef.id) : undefined),
    [catalog, campaign],
  );
  const compiled = useMemo(
    () => (template ? catalog.compile(template) : undefined),
    [catalog, template],
  );

  const active = live.kind === 'mestre' && live.campaignId === campaignId;
  const player = active ? live.players.find((p) => p.sheetId === sheetId) : undefined;
  const back = `/campanhas/${campaignId}`;

  if (!campaign || !compiled) return null;
  if (!player?.sheet) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <p className="text-muted-foreground">
          {active
            ? 'A ficha deste jogador ainda não chegou nesta sessão.'
            : 'Abra a sessão da campanha para ver e alterar as fichas dos jogadores.'}
        </p>
        <Button variant="outline" asChild>
          <Link href={back}>Voltar à campanha</Link>
        </Button>
      </div>
    );
  }

  return (
    <PlayerSheet
      campaignId={campaignId}
      player={player as HostPlayer & { sheet: NonNullable<HostPlayer['sheet']> }}
      compiled={compiled}
      back={back}
    />
  );
}

function PlayerSheet({
  campaignId,
  player,
  compiled,
  back,
}: {
  campaignId: string;
  player: HostPlayer & { sheet: NonNullable<HostPlayer['sheet']> };
  compiled: CompiledTemplate;
  back: string;
}) {
  const { session } = useServices();
  const { sheetId } = player;
  const secrets = useLiveQuery(
    () => session.secretValues(campaignId, sheetId),
    [session, campaignId, sheetId],
  );

  const secretIds = useMemo(
    () => new Set(compiled.template.fields.filter((f) => f.visibility === 'gm').map((f) => f.id)),
    [compiled],
  );
  // Ficha como o Mestre a vê: o que veio do jogador + os segredos guardados aqui.
  const stored = useMemo(() => {
    const values: Record<string, FieldValue> = { ...player.sheet.values, ...secrets };
    for (const field of compiled.template.fields) {
      if (values[field.id] !== undefined) continue;
      const initial = defaultValue(field);
      if (initial !== undefined) values[field.id] = initial;
    }
    return values;
  }, [player.sheet.values, secrets, compiled]);

  const persist = useCallback(
    async (fieldId: string, value: FieldValue) => {
      const result = await session.setPlayerValue(campaignId, sheetId, fieldId, value);
      if (!result.ok) throw new Error(result.error.message);
    },
    [session, campaignId, sheetId],
  );
  const { values, derived, onChange } = useSheetEditing(compiled, stored, persist);
  const roller = useRoller(compiled);
  // O Mestre rolando pela ficha do jogador: o registro mostra de quem é o teste.
  const playerRoller = useMemo(
    () => ({
      ...roller,
      roll: (label: string, expression: string) =>
        roller.roll(`${player.sheet.name}: ${label}`, expression),
    }),
    [roller, player.sheet.name],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href={back} aria-label="Voltar à campanha">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <h1 className="min-w-0 truncate text-xl font-bold">{player.sheet.name}</h1>
        <Badge variant="secondary">{player.displayName}</Badge>
        <Badge variant={player.online ? 'default' : 'outline'}>
          {player.online ? 'Online' : 'Offline'}
        </Badge>
      </div>
      <p className="text-muted-foreground text-sm" role="status">
        {player.online
          ? 'Suas alterações aparecem para o jogador na hora.'
          : 'O jogador está offline: suas alterações chegam quando ele voltar à sessão.'}
        {secretIds.size > 0 && (
          <>
            {' '}
            Campos marcados com <EyeOffIcon className="inline size-3.5" /> ficam só neste aparelho.
          </>
        )}
      </p>
      <RollContext value={playerRoller}>
        <SheetVitals compiled={compiled} values={values} derived={derived} onChange={onChange} />
        <SheetLayout
          compiled={compiled}
          values={values}
          derived={derived}
          onChange={onChange}
          newItemId={() => crypto.randomUUID()}
          secretFieldIds={secretIds}
        />
      </RollContext>
    </div>
  );
}
