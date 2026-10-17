import { describeRoll } from '@tabula/domain';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useServices } from '@/app/services-context';

/**
 * Rolagens em qualquer tela do app: as de outras pessoas da mesa aparecem num aviso, com o
 * som dos dados; as deste aparelho só tocam o som (o resultado já aparece onde se rolou).
 */
export function RollNotice() {
  const { session, sounds } = useServices();
  useEffect(
    () =>
      session.onRoll((entry) => {
        const what = entry.label ? `${entry.authorName} · ${entry.label}` : entry.authorName;
        toast(`${what}: ${entry.result.total}`, { description: describeRoll(entry.result) });
        void sounds.play('rolagem');
      }),
    [session, sounds],
  );
  useEffect(() => session.onOwnRoll(() => void sounds.play('rolagem')), [session, sounds]);
  return null;
}
