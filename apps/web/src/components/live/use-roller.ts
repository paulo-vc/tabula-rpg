import { describeRoll, type CompiledTemplate } from '@tabula/domain';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { useServices } from '@/app/services-context';
import type { Roller } from '@/components/sheet/roll-context';

/**
 * Rolagens feitas pela ficha: entram no registro da sessão (se houver uma) e o resultado
 * aparece num aviso.
 */
export function useRoller(compiled: CompiledTemplate): Roller {
  const { session } = useServices();
  const checkDice = compiled.template.checkDice ?? '1d20';
  return useMemo(
    () => ({
      checkDice,
      roll: (label, expression) => {
        void session.roll({ label, expression }).then((result) => {
          if (result.ok) {
            toast(`${label}: ${result.value.result.total}`, {
              description: describeRoll(result.value.result),
            });
          } else {
            toast.error('Não foi possível rolar', { description: result.error.message });
          }
        });
      },
    }),
    [session, checkDice],
  );
}
