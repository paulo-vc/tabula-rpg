import { useEffect } from 'react';
import { toast } from 'sonner';
import { useServices } from '@/app/services-context';
import { useLiveSession } from './use-live-session';

/**
 * Avisos da sessão em qualquer tela do app: a vez do jogador no combate (aviso e som) e o
 * som das mensagens do chat. As rolagens têm o aviso delas (`RollNotice`).
 */
export function SessionNotices() {
  const { session, sounds } = useServices();
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
  const turnKey = tracker ? `${tracker.round}:${tracker.activeId}` : null;
  useEffect(() => {
    if (!myTurn) return;
    toast('É a sua vez!', { id: 'sua-vez' });
    void sounds.play('sua-vez');
  }, [myTurn, turnKey, sounds]);

  return null;
}
