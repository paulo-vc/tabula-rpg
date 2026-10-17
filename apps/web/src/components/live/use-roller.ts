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
      rollAll: (title, rolls) => {
        void (async () => {
          const results = [];
          for (const roll of rolls) {
            const result = await session.roll({
              label: `${title}: ${roll.name}`,
              expression: roll.expression,
            });
            if (!result.ok) {
              toast.error('Não foi possível rolar', { description: result.error.message });
              return;
            }
            results.push({ name: roll.name, entry: result.value });
          }
          // "Espada longa: ataque 17 · dano 9", com a conta de cada um embaixo.
          toast(
            `${title}: ${results.map((r) => `${r.name} ${r.entry.result.total}`).join(' · ')}`,
            {
              description: results.map((r) => describeRoll(r.entry.result)).join(' | '),
            },
          );
        })();
      },
    }),
    [session, checkDice],
  );
}
