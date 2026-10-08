import {
  computeDerived,
  type CompiledTemplate,
  type FieldValue,
  type SheetValues,
} from '@tabula/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

/** Pausa (ms) antes de gravar: digitar "16" grava uma vez, não duas. */
const SAVE_DELAY = 400;

/**
 * Edição otimista de uma ficha: o valor aparece e os cálculos se atualizam na hora; a
 * gravação (`persist`) acontece após uma pausa, por campo. Cliques rápidos (ex.: "+" no HP)
 * partem sempre do valor mais recente. Gravações pendentes são feitas ao sair da página ou
 * esconder a aba.
 *
 * `persist` decide para onde vai o valor: a ficha local (jogador) ou a ficha do jogador na
 * sessão (Mestre).
 */
export function useSheetEditing(
  compiled: CompiledTemplate,
  stored: SheetValues | undefined,
  persist: (fieldId: string, value: FieldValue) => Promise<void>,
) {
  const [pending, setPending] = useState<Record<string, FieldValue>>({});
  const values = useMemo(() => ({ ...stored, ...pending }), [stored, pending]);
  const derived = useMemo(() => computeDerived(compiled, values), [compiled, values]);

  const queue = useRef(new Map<string, FieldValue>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const save = useCallback(
    (fieldId: string) => {
      clearTimeout(timers.current.get(fieldId));
      timers.current.delete(fieldId);
      if (!queue.current.has(fieldId)) return;
      const value = queue.current.get(fieldId) as FieldValue;
      queue.current.delete(fieldId);
      persist(fieldId, value).then(
        () =>
          setPending((current) => {
            if (current[fieldId] !== value) return current; // já há um valor mais novo
            const { [fieldId]: _saved, ...rest } = current;
            return rest;
          }),
        (error: unknown) => {
          toast.error('Não foi possível salvar', {
            description: error instanceof Error ? error.message : String(error),
          });
          // Volta ao valor gravado: o que está na tela não foi salvo.
          setPending((current) => {
            const { [fieldId]: _failed, ...rest } = current;
            return rest;
          });
        },
      );
    },
    [persist],
  );

  useEffect(() => {
    const saveAll = () => [...queue.current.keys()].forEach(save);
    const onHide = () => document.visibilityState === 'hidden' && saveAll();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', saveAll);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', saveAll);
      saveAll(); // ao sair da página da ficha
    };
  }, [save]);

  const onChange = useCallback(
    (fieldId: string, value: FieldValue) => {
      setPending((current) => ({ ...current, [fieldId]: value }));
      queue.current.set(fieldId, value);
      clearTimeout(timers.current.get(fieldId));
      timers.current.set(
        fieldId,
        setTimeout(() => save(fieldId), SAVE_DELAY),
      );
    },
    [save],
  );

  return { values, derived, onChange };
}
