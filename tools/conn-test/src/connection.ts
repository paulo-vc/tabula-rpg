/**
 * Descreve como uma conexão WebRTC foi estabelecida, a partir de `RTCPeerConnection.getStats()`.
 */

export type ConnectionKind =
  /** Mesma rede local (candidatos `host` dos dois lados). */
  | 'rede-local'
  /** Pela internet, atravessando o NAT com ajuda do STUN. */
  | 'direta'
  /** Por um servidor TURN (relay). */
  | 'relay';

export interface ConnectionInfo {
  kind: ConnectionKind;
  ipVersion: 4 | 6 | null;
  protocol: string | null;
  /** Tempo de ida e volta, em ms, se o navegador informar. */
  rttMs: number | null;
}

/** Entrada de estatística como vem do navegador (o que usamos). */
export interface StatsEntry {
  id: string;
  type: string;
  [key: string]: unknown;
}

const str = (value: unknown) => (typeof value === 'string' ? value : null);

/** Encontra o par de candidatos em uso e descreve a conexão. `null` se ainda não há par ativo. */
export function describeConnection(stats: readonly StatsEntry[]): ConnectionInfo | null {
  const byId = new Map(stats.map((entry) => [entry.id, entry]));

  // Preferência: o par apontado pelo transporte; senão, um par nomeado e bem-sucedido.
  const transport = stats.find(
    (entry) => entry.type === 'transport' && str(entry.selectedCandidatePairId),
  );
  const pair =
    (transport && byId.get(str(transport.selectedCandidatePairId) as string)) ??
    stats.find(
      (entry) =>
        entry.type === 'candidate-pair' && entry.state === 'succeeded' && entry.nominated === true,
    ) ??
    stats.find((entry) => entry.type === 'candidate-pair' && entry.selected === true);
  if (!pair) return null;

  const local = byId.get(str(pair.localCandidateId) ?? '');
  const remote = byId.get(str(pair.remoteCandidateId) ?? '');
  const types = [str(local?.candidateType), str(remote?.candidateType)];

  const kind: ConnectionKind = types.includes('relay')
    ? 'relay'
    : types.every((t) => t === 'host')
      ? 'rede-local'
      : 'direta';

  const address = str(local?.address) ?? str(local?.ip);
  const ipVersion = address === null ? null : address.includes(':') ? 6 : 4;
  const rtt = pair.currentRoundTripTime;

  return {
    kind,
    ipVersion,
    protocol: str(local?.protocol),
    rttMs: typeof rtt === 'number' ? Math.round(rtt * 1000) : null,
  };
}

export const CONNECTION_LABEL: Record<ConnectionKind, string> = {
  'rede-local': 'Direta (mesma rede)',
  direta: 'Direta pela internet',
  relay: 'Via relay (TURN)',
};
