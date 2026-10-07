import type { RegistryIndex } from '@tabula/domain';
import { useCallback, useEffect, useState } from 'react';
import { useServices } from '@/app/services-context';

export type IndexState =
  | { status: 'carregando' }
  | { status: 'pronto'; index: RegistryIndex }
  | { status: 'erro'; message: string };

/** Catálogo da comunidade, baixado ao abrir a tela. `reload` tenta de novo. */
export function useRegistryIndex() {
  const { registry } = useServices();
  const [state, setState] = useState<IndexState>({ status: 'carregando' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    registry.loadIndex().then(
      (index) => active && setState({ status: 'pronto', index }),
      (error: unknown) =>
        active &&
        setState({
          status: 'erro',
          message: error instanceof Error ? error.message : 'Erro ao carregar o catálogo.',
        }),
    );
    return () => {
      active = false;
    };
  }, [registry, attempt]);

  const reload = useCallback(() => {
    setState({ status: 'carregando' });
    setAttempt((n) => n + 1);
  }, []);

  return { state, reload };
}
