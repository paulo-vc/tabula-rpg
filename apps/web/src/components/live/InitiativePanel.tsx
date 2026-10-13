import {
  addCombatant,
  INITIATIVE_RANGE,
  nextTurn,
  parseInitiativeInput,
  previousTurn,
  removeCombatant,
  startCombat,
  turnOrder,
  updateCombatant,
  type Combatant,
  type PublicTracker,
  type Tracker,
} from '@tabula/domain';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DicesIcon,
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  SkullIcon,
  SwordsIcon,
  Trash2Icon,
  UserIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useServices } from '@/app/services-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLiveSession } from './use-live-session';

/** Quantas criaturas iguais o Mestre adiciona de uma vez. */
const MAX_AT_ONCE = 10;

const parseInitiative = (text: string): number | null => {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isInteger(value) && Math.abs(value) <= INITIATIVE_RANGE
    ? value
    : null;
};

/**
 * Iniciativa editável de um participante. Grava ao sair do campo ou com Enter, e não a cada
 * tecla: senão a lista se reordenaria no meio da digitação.
 */
function InitiativeInput({
  name,
  value,
  onCommit,
}: {
  name: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  // Sem efeito para acompanhar o valor externo: quem usa remonta pela `key` quando ele muda.
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const parsed = parseInitiative(draft);
    if (parsed === null) setDraft(String(value));
    else if (parsed !== value) onCommit(parsed);
  };
  return (
    <Input
      aria-label={`Iniciativa de ${name}`}
      inputMode="numeric"
      value={draft}
      aria-invalid={parseInitiative(draft) === null}
      className="h-8 w-14 shrink-0 text-center tabular-nums"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
}

function RoundTitle({ tracker }: { tracker: { phase: string; round: number } | null }) {
  return (
    <CardTitle className="flex items-center gap-2">
      <SwordsIcon className="size-4" />
      <h2>Combate</h2>
      {tracker && (
        <Badge variant="secondary">
          {tracker.phase === 'preparando' ? 'Preparando' : `Rodada ${tracker.round}`}
        </Badge>
      )}
    </CardTitle>
  );
}

/** Ordem de turno, do lado do Mestre: monta o combate, define iniciativas e passa a vez. */
export function GameMasterInitiative({
  campaignId,
  checkDice = '1d20',
}: {
  campaignId: string;
  /** Dado dos testes do sistema: um modificador ("+3") rola com ele. */
  checkDice?: string | undefined;
}) {
  const { session } = useServices();
  const live = useLiveSession();
  const base = useId();
  const [name, setName] = useState('');
  const [initiative, setInitiative] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [hidden, setHidden] = useState(false);
  const [adding, setAdding] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  if (live.kind !== 'mestre' || live.campaignId !== campaignId) return null;
  const tracker = live.initiative;

  const change = (update: (current: Tracker | null) => Tracker | null) => {
    const result = session.updateInitiative(campaignId, update);
    if (!result.ok)
      toast.error('Não foi possível alterar o combate', { description: result.error.message });
  };
  const start = () =>
    change(() =>
      startCombat(
        live.players.map((player) => ({
          id: player.sheetId,
          name: player.sheet?.name ?? player.displayName,
          userId: player.userId,
        })),
      ),
    );
  const parsedInitiative = parseInitiativeInput(initiative, checkDice);
  const count = Number(quantity);
  const validCount = Number.isInteger(count) && count >= 1 && count <= MAX_AT_ONCE;

  // Adiciona uma ou mais criaturas. Com modificador ou rolagem, cada uma rola a própria
  // iniciativa, em segredo (só o Mestre vê no registro).
  const add = async (event: FormEvent) => {
    event.preventDefault();
    const baseName = name.trim();
    if (!baseName || !parsedInitiative || !validCount || adding) return;
    setAdding(true);
    try {
      const created: Combatant[] = [];
      for (let i = 1; i <= count; i++) {
        const label = count > 1 ? `${baseName} ${i}` : baseName;
        let value = parsedInitiative.kind === 'valor' ? parsedInitiative.value : 0;
        if (parsedInitiative.kind === 'rolar') {
          const rolled = await session.roll({
            label: `Iniciativa: ${label}`,
            expression: parsedInitiative.expression,
            secret: true,
          });
          if (!rolled.ok) {
            toast.error('Não foi possível rolar', { description: rolled.error.message });
            return;
          }
          value = rolled.value.result.total;
        }
        const initiativeValue = Math.max(-INITIATIVE_RANGE, Math.min(INITIATIVE_RANGE, value));
        created.push({
          id: crypto.randomUUID(),
          name: label,
          initiative: initiativeValue,
          kind: 'npc',
          hidden,
        });
      }
      change((current) => current && created.reduce(addCombatant, current));
      if (parsedInitiative.kind === 'rolar') {
        toast(created.map((c) => `${c.name}: ${c.initiative}`).join(' · '), {
          description: `Iniciativa (${parsedInitiative.expression})`,
        });
      }
      setName('');
      setInitiative('');
      setQuantity('1');
      nameRef.current?.focus();
    } finally {
      setAdding(false);
    }
  };

  if (!tracker) {
    return (
      <Card>
        <CardHeader>
          <RoundTitle tracker={null} />
          <CardDescription>
            Monte a ordem de turno com os jogadores da sessão e os inimigos. Os jogadores veem a
            ordem e quando é a vez deles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={start}>
            <SwordsIcon /> Iniciar combate
          </Button>
        </CardContent>
      </Card>
    );
  }

  const order = turnOrder(tracker.combatants);
  const empty = order.length === 0;
  return (
    <Card>
      <CardHeader>
        <RoundTitle tracker={tracker} />
        <CardDescription>
          {tracker.phase === 'preparando'
            ? 'Defina as iniciativas e comece. Ocultos aparecem só para você.'
            : 'Os jogadores veem a ordem, sem os ocultos.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={empty}
            onClick={() => change((current) => current && nextTurn(current))}
          >
            {tracker.phase === 'preparando' ? 'Começar' : 'Próximo turno'} <ChevronRightIcon />
          </Button>
          {tracker.phase === 'combate' && (
            <Button
              variant="outline"
              aria-label="Turno anterior"
              onClick={() => change((current) => current && previousTurn(current))}
            >
              <ChevronLeftIcon />
            </Button>
          )}
          <Button variant="ghost" className="ml-auto" onClick={() => change(() => null)}>
            Encerrar combate
          </Button>
        </div>

        {empty ? (
          <p className="text-muted-foreground text-sm">Ninguém no combate. Adicione abaixo.</p>
        ) : (
          <ol aria-label="Ordem de turno" className="space-y-1">
            {order.map((combatant) => {
              const current = combatant.id === tracker.activeId;
              return (
                <li
                  key={combatant.id}
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-2 py-1',
                    current && 'border-primary bg-primary/10',
                    combatant.hidden && 'border-dashed',
                  )}
                >
                  <InitiativeInput
                    key={`${combatant.id}:${combatant.initiative}`}
                    name={combatant.name}
                    value={combatant.initiative}
                    onCommit={(value) =>
                      change((t) => t && updateCombatant(t, combatant.id, { initiative: value }))
                    }
                  />
                  {combatant.kind === 'jogador' ? (
                    <UserIcon
                      className="text-muted-foreground size-4 shrink-0"
                      aria-label="Jogador"
                    />
                  ) : (
                    <SkullIcon
                      className="text-muted-foreground size-4 shrink-0"
                      aria-label="Criatura"
                    />
                  )}
                  <span className={cn('min-w-0 flex-1 truncate', current && 'font-semibold')}>
                    {combatant.name}
                  </span>
                  {current && <Badge className="hidden sm:inline-flex">Agora</Badge>}
                  {combatant.kind === 'npc' && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-pressed={combatant.hidden}
                      aria-label={`${combatant.hidden ? 'Mostrar' : 'Ocultar'} ${combatant.name} para os jogadores`}
                      title={
                        combatant.hidden ? 'Oculto para os jogadores' : 'Visível para os jogadores'
                      }
                      onClick={() =>
                        change(
                          (t) =>
                            t && updateCombatant(t, combatant.id, { hidden: !combatant.hidden }),
                        )
                      }
                    >
                      {combatant.hidden ? <EyeOffIcon /> : <EyeIcon />}
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Tirar ${combatant.name} do combate`}
                    onClick={() => change((t) => t && removeCombatant(t, combatant.id))}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              );
            })}
          </ol>
        )}

        <form
          onSubmit={(event) => void add(event)}
          className="flex flex-wrap items-end gap-2 border-t pt-3"
        >
          <div className="min-w-32 flex-1 space-y-1">
            <Label htmlFor={`${base}-nome`} className="text-xs">
              Criatura
            </Label>
            <Input
              ref={nameRef}
              id={`${base}-nome`}
              value={name}
              maxLength={60}
              placeholder="ex.: Goblin 1"
              className="h-8"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${base}-ini`} className="text-xs">
              Iniciativa
            </Label>
            <Input
              id={`${base}-ini`}
              value={initiative}
              placeholder="+2"
              title={`Um número (15), um modificador (+2 rola ${checkDice}+2) ou uma rolagem (2d6+1)`}
              aria-describedby={`${base}-ini-ajuda`}
              aria-invalid={initiative.trim() !== '' && !parsedInitiative}
              className="h-8 w-24 text-center font-mono"
              onChange={(event) => setInitiative(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${base}-qtd`} className="text-xs">
              Qtd.
            </Label>
            <Input
              id={`${base}-qtd`}
              inputMode="numeric"
              value={quantity}
              aria-invalid={!validCount}
              className="h-8 w-12 text-center"
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
          <div className="flex h-8 items-center gap-1.5">
            <Checkbox
              id={`${base}-oculto`}
              checked={hidden}
              onCheckedChange={(value) => setHidden(value === true)}
            />
            <Label htmlFor={`${base}-oculto`} className="text-xs font-normal">
              Oculto
            </Label>
          </div>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!name.trim() || !parsedInitiative || !validCount || adding}
          >
            <PlusIcon /> Adicionar
          </Button>
          <p id={`${base}-ini-ajuda`} className="text-muted-foreground w-full text-xs">
            Iniciativa: um número (<span className="font-mono">15</span>), um modificador (
            <span className="font-mono">+2</span> rola{' '}
            <span className="font-mono">{checkDice}+2</span>) ou uma rolagem (
            <span className="font-mono">2d6+1</span>). Com quantidade, cada criatura rola a sua.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

/** Ordem de turno, do lado do jogador: só leitura, com aviso quando é a vez dele. */
export function PlayerInitiative({
  campaignId,
  initiativeRoll,
}: {
  campaignId: string;
  /** Rolagem de iniciativa da ficha do jogador (ex.: "1d20+2"), se o sistema define uma. */
  initiativeRoll?: string | null | undefined;
}) {
  const { session } = useServices();
  const live = useLiveSession();
  const tracker: PublicTracker | null =
    live.kind === 'jogador' && live.campaignId === campaignId ? live.initiative : null;
  const userId = live.kind === 'jogador' ? live.userId : null;
  const mine = tracker?.combatants.find((c) => c.id === tracker.activeId)?.userId === userId;
  const myTurn = tracker?.phase === 'combate' && mine;
  const inCombat = tracker?.combatants.some((c) => c.userId === userId) ?? false;

  // Aviso ao chegar a vez (uma vez por turno), mesmo com o jogador em outra tela.
  const turnKey = tracker ? `${tracker.round}:${tracker.activeId}` : null;
  useEffect(() => {
    if (myTurn) toast('É a sua vez!', { id: 'sua-vez' });
  }, [myTurn, turnKey]);

  if (!tracker) return null;
  const order = turnOrder(tracker.combatants);
  return (
    <Card>
      <CardHeader>
        <RoundTitle tracker={tracker} />
        <CardDescription role="status">
          {tracker.phase === 'preparando'
            ? 'O Mestre está definindo a ordem de turno.'
            : myTurn
              ? 'É a sua vez!'
              : tracker.activeId === null
                ? 'Vez do Mestre.'
                : `Vez de ${order.find((c) => c.id === tracker.activeId)?.name ?? '…'}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tracker.phase === 'preparando' && initiativeRoll && inCombat && (
          <Button
            onClick={() =>
              void session
                .roll({ label: 'Iniciativa', expression: initiativeRoll, purpose: 'iniciativa' })
                .then((result) => {
                  if (result.ok) toast(`Iniciativa: ${result.value.result.total}`);
                  else toast.error('Não foi possível rolar', { description: result.error.message });
                })
            }
          >
            <DicesIcon /> Rolar iniciativa ({initiativeRoll})
          </Button>
        )}
        <ol aria-label="Ordem de turno" className="space-y-1">
          {order.map((combatant) => {
            const current = combatant.id === tracker.activeId;
            return (
              <li
                key={combatant.id}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2 py-1 text-sm',
                  current && 'border-primary bg-primary/10 font-semibold',
                )}
              >
                <span className="text-muted-foreground w-8 text-right tabular-nums">
                  {combatant.initiative}
                </span>
                <span className="min-w-0 flex-1 truncate">{combatant.name}</span>
                {combatant.userId === userId && <Badge variant="outline">Você</Badge>}
                {current && <Badge>Agora</Badge>}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
