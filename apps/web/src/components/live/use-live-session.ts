import { useSyncExternalStore } from 'react';
import type { LiveSession } from '@/app/live-session';
import { useServices } from '@/app/services-context';

/** Estado da sessão ao vivo deste dispositivo, atualizado a cada mudança. */
export function useLiveSession(): LiveSession {
  const { session } = useServices();
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
