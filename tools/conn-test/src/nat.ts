/**
 * Diagnóstico da rede local a partir de candidatos ICE.
 *
 * O NAT traduz (IP local, porta local) para um par público. Perguntando a dois servidores
 * STUN diferentes a partir do mesmo socket:
 * - NAT "cone" (independente do destino): os dois veem a mesma porta pública. Conexão direta
 *   costuma funcionar.
 * - NAT "simétrico" (depende do destino): cada servidor vê uma porta diferente. Conexão direta
 *   falha se o outro lado também for restritivo, e aí é preciso relay.
 *
 * Os navegadores descartam candidatos duplicados: num NAT cone, a coleta com os dois servidores
 * produz um único candidato, igual ao caso em que só um servidor respondeu. Por isso, primeiro
 * se verifica cada servidor isoladamente (`reachableServers`) e só então se comparam as portas
 * da coleta conjunta.
 */

/** O subconjunto de um RTCIceCandidate que usamos (facilita testar sem navegador). */
export interface GatheredCandidate {
  type: 'host' | 'srflx' | 'prflx' | 'relay';
  address: string;
  port: number;
  protocol: 'udp' | 'tcp';
}

export type NatType = 'aberto' | 'cone' | 'simetrico' | 'udp-bloqueado' | 'indeterminado';

export interface NatDiagnosis {
  natType: NatType;
  /** Algum endereço público IPv6 foi descoberto (conexão direta sem NAT é possível). */
  ipv6: boolean;
  /** Quantos servidores STUN responderam quando consultados isoladamente. */
  reachableServers: number;
}

const isIpv6 = (address: string) => address.includes(':');
const isMdns = (address: string) => address.endsWith('.local');

/**
 * @param combined candidatos de uma coleta com os dois servidores STUN no mesmo RTCPeerConnection.
 * @param reachableServers quantos servidores responderam em coletas separadas, um de cada vez.
 */
export function diagnoseNat(
  combined: readonly GatheredCandidate[],
  reachableServers: number,
): NatDiagnosis {
  const udp = combined.filter((c) => c.protocol === 'udp');
  const reflexive = udp.filter((c) => c.type === 'srflx');
  const ipv6 = reflexive.some((c) => isIpv6(c.address));
  const result = (natType: NatType): NatDiagnosis => ({ natType, ipv6, reachableServers });

  if (reachableServers === 0 || reflexive.length === 0) return result('udp-bloqueado');

  const ipv4 = reflexive.filter((c) => !isIpv6(c.address));
  if (ipv4.length === 0) return result(ipv6 ? 'aberto' : 'indeterminado');

  // Endereço público igual a um endereço local (não mascarado por mDNS): não há NAT.
  const hostAddresses = new Set(
    udp.filter((c) => c.type === 'host' && !isMdns(c.address)).map((c) => c.address),
  );
  if (ipv4.some((c) => hostAddresses.has(c.address))) return result('aberto');

  // Portas públicas diferentes para o mesmo IP público = mapeamento depende do destino.
  const portsPerAddress = new Map<string, Set<number>>();
  for (const candidate of ipv4) {
    const ports = portsPerAddress.get(candidate.address) ?? new Set<number>();
    portsPerAddress.set(candidate.address, ports.add(candidate.port));
  }
  if ([...portsPerAddress.values()].some((ports) => ports.size > 1)) return result('simetrico');

  // Uma porta só: é cone, desde que os dois servidores tenham respondido.
  return result(reachableServers >= 2 ? 'cone' : 'indeterminado');
}

export const NAT_DESCRIPTION: Record<NatType, string> = {
  aberto: 'Sem NAT (endereço público direto): conexões diretas funcionam.',
  cone: 'NAT comum ("cone"): conexões diretas costumam funcionar.',
  simetrico:
    'NAT restritivo ("simétrico", comum em 4G/5G e CGNAT): conexão direta só funciona se o outro lado não for restritivo.',
  'udp-bloqueado':
    'Nenhum servidor STUN respondeu: UDP parece bloqueado (rede corporativa/escola?). Só um relay funcionaria.',
  indeterminado: 'Não foi possível determinar o tipo de NAT (só um servidor de teste respondeu).',
};
