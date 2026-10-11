import type { ConnectionInfo } from '@tabula/sync';
import { useEffect, useState } from 'react';

const PATH_LABELS: Record<ConnectionInfo['path'], string> = {
  direta: 'conexão direta',
  retransmitida: 'via servidor',
};

const seconds = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** "conexão direta · 42 ms" (ou só o caminho, enquanto a latência não foi medida). */
export function describeConnection(info: ConnectionInfo): string {
  const path = PATH_LABELS[info.path];
  return info.rttMs === null ? path : `${path} · ${info.rttMs} ms`;
}

/** Duração legível: "1,8 s", "42 s", "2 min 5 s". */
export function describeDuration(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  if (total < 10) return `${seconds.format(total)} s`;
  const whole = Math.round(total);
  if (whole < 60) return `${whole} s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/**
 * Hora atual, atualizada a cada segundo enquanto `running` (ex.: procurando o Mestre). Quem
 * usa limita a diferença a zero: no primeiro segundo, o valor ainda é o da montagem.
 */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}
