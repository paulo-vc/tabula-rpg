import { describeRoll } from '@tabula/domain';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useServices } from '@/app/services-context';

/** Mostra as rolagens que outras pessoas da mesa fazem (em qualquer tela do app). */
export function RollNotice() {
  const { session } = useServices();
  useEffect(
    () =>
      session.onRoll((entry) => {
        const what = entry.label ? `${entry.authorName} · ${entry.label}` : entry.authorName;
        toast(`${what}: ${entry.result.total}`, { description: describeRoll(entry.result) });
      }),
    [session],
  );
  return null;
}
