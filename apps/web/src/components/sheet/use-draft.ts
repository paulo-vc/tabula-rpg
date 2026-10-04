import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Estado de rascunho para campos de texto/número: a digitação é local e imediata, e o valor
 * é confirmado (`commit`) após uma pausa (`delay`) ou ao sair do campo; com `delay` 0, a cada
 * alteração. Enquanto o usuário não está editando, o rascunho acompanha o valor externo
 * (ex.: alterado em outra aba ou pelo Mestre).
 */
export function useDraft<T>(value: T, commit: (value: T) => void, delay = 0) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<{ value: T } | null>(null);
  // Sempre a versão mais recente de `commit`, sem reiniciar os timers a cada renderização.
  const commitRef = useRef(commit);
  useLayoutEffect(() => {
    commitRef.current = commit;
  });

  // Valor externo mudou e o usuário não está editando: acompanha.
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current) {
      commitRef.current(pending.current.value);
      pending.current = null;
    }
  }, []);

  // Grava o que estiver pendente ao desmontar (ex.: trocar de página logo após digitar).
  useEffect(() => flush, [flush]);

  const change = useCallback(
    (next: T) => {
      editing.current = true;
      setDraft(next);
      clearTimeout(timer.current);
      pending.current = { value: next };
      if (delay <= 0) flush();
      else timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );

  const blur = useCallback(() => {
    flush();
    editing.current = false;
  }, [flush]);

  return { draft, change, blur, setDraft };
}
