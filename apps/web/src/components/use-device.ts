import { useEffect, useState } from 'react';
import { useServices } from '@/app/services-context';

/**
 * ID deste dispositivo. Fica fora das consultas reativas porque a primeira chamada grava
 * (cria o ID), e consultas reativas precisam ser somente leitura.
 */
export function useDeviceId(): string | undefined {
  const { device } = useServices();
  const [id, setId] = useState<string>();
  useEffect(() => {
    let active = true;
    device.getDeviceId().then(
      (value) => active && setId(value),
      (error: unknown) => active && console.error('Falha ao ler o ID do dispositivo', error),
    );
    return () => {
      active = false;
    };
  }, [device]);
  return id;
}

/** Último nome de exibição usado, para preencher formulários. */
export function useDisplayName(): string | undefined {
  const { device } = useServices();
  const [name, setName] = useState<string>();
  useEffect(() => {
    let active = true;
    device.getDisplayName().then(
      (value) => active && setName(value ?? ''),
      (error: unknown) => active && console.error('Falha ao ler o nome de exibição', error),
    );
    return () => {
      active = false;
    };
  }, [device]);
  return name;
}
