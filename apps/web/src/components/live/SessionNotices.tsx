import { SwordsIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import { useLiveSession } from './use-live-session';

/**
 * Avisos da sessão em qualquer tela do app: a vez do jogador no combate (faixa na tela,
 * som e aviso fora do app) e o som das mensagens do chat. As rolagens têm o aviso delas
 * (`RollNotice`).
 */
export function SessionNotices() {
  const { session, sounds, attention } = useServices();
  const live = useLiveSession();

  useEffect(
    () =>
      session.onChat((message) => {
        void sounds.play(message.to === undefined ? 'mensagem' : 'sussurro');
      }),
    [session, sounds],
  );

  // A vez do jogador: uma vez por turno (rodada e participante ativo).
  const tracker = live.kind === 'jogador' ? live.initiative : null;
  const userId = live.kind === 'jogador' ? live.userId : null;
  const active = tracker?.combatants.find((c) => c.id === tracker.activeId);
  const myTurn = tracker?.phase === 'combate' && active !== undefined && active.userId === userId;
  const turnKey = myTurn && tracker ? `${tracker.round}:${tracker.activeId}` : null;
  const [dismissed, setDismissed] = useState<string | null>(null);

  const round = tracker?.round;
  const activeName = active?.name;
  useEffect(() => {
    if (!turnKey) return;
    void sounds.play('sua-vez');
    attention.notify('Sua vez!', `Rodada ${round}: é a vez de ${activeName ?? 'você'}.`);
  }, [turnKey, round, activeName, sounds, attention]);

  if (!turnKey || dismissed === turnKey || !tracker) return null;
  return (
    <div
      role="alert"
      className="pointer-events-none fixed inset-x-0 top-20 z-[45] flex justify-center px-4"
    >
      <div className="bg-primary text-primary-foreground animate-in fade-in zoom-in-95 pointer-events-auto relative flex items-center gap-4 rounded-2xl px-6 py-4 shadow-2xl duration-300">
        <span
          aria-hidden
          className="ring-primary absolute inset-0 animate-ping rounded-2xl opacity-40 ring-4 [animation-iteration-count:3]"
        />
        <SwordsIcon className="size-8 shrink-0" aria-hidden />
        <div>
          <p className="text-2xl font-bold tracking-tight">É a sua vez!</p>
          <p className="text-sm opacity-90">
            Rodada {tracker.round}
            {active && ` · ${active.name}`}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="hover:bg-primary-foreground/15 hover:text-primary-foreground ml-2"
          aria-label="Fechar aviso"
          onClick={() => setDismissed(turnKey)}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  );
}
