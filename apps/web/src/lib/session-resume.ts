import type { LiveSessionManager } from '@/app/live-session';

const KEY = 'tabula:sessao-ativa';

interface ActiveSession {
  kind: 'mestre' | 'jogador';
  campaignId: string;
}

/**
 * Retoma a sessão ao vivo depois de recarregar a página (F5, aba recarregada pelo celular).
 *
 * Usa `sessionStorage`: vale só para esta aba e some quando ela é fechada. Assim, recarregar
 * volta para a mesa, mas abrir o app de novo em outra aba não entra sozinho numa sessão.
 */
export function keepSessionAcrossReloads(
  session: LiveSessionManager,
  storage: Storage = sessionStorage,
) {
  const read = (): ActiveSession | null => {
    try {
      const value = JSON.parse(storage.getItem(KEY) ?? 'null') as unknown;
      if (
        value &&
        typeof value === 'object' &&
        'campaignId' in value &&
        typeof value.campaignId === 'string' &&
        'kind' in value &&
        (value.kind === 'mestre' || value.kind === 'jogador')
      ) {
        return { kind: value.kind, campaignId: value.campaignId };
      }
    } catch {
      // armazenamento indisponível ou conteúdo inválido: não retoma
    }
    return null;
  };

  const write = () => {
    const snapshot = session.getSnapshot();
    try {
      if (snapshot.kind === 'nenhuma') storage.removeItem(KEY);
      else
        storage.setItem(
          KEY,
          JSON.stringify({ kind: snapshot.kind, campaignId: snapshot.campaignId }),
        );
    } catch {
      // armazenamento indisponível (ex.: modo privado restrito): só não retoma
    }
  };

  const previous = read();
  const unsubscribe = session.subscribe(write);
  if (previous) {
    const resume =
      previous.kind === 'mestre'
        ? session.startAsGameMaster(previous.campaignId)
        : session.joinAsPlayer(previous.campaignId);
    // A campanha pode ter sido apagada ou a ficha desvinculada: nesse caso, esquece.
    void resume.then((result) => {
      if (!result.ok) write();
    });
  }
  return unsubscribe;
}
