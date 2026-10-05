import { diagnoseNat, type GatheredCandidate, type NatDiagnosis } from './nat';

/** Servidores STUN públicos e gratuitos, de empresas diferentes. */
export const STUN_SERVERS = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

/** Coleta os candidatos ICE de uma conexão de teste (sem conectar a ninguém). */
export async function gatherCandidates(
  stunUrls: readonly string[],
  timeoutMs = 6000,
): Promise<GatheredCandidate[]> {
  const pc = new RTCPeerConnection({ iceServers: stunUrls.map((urls) => ({ urls })) });
  const candidates: GatheredCandidate[] = [];
  try {
    pc.createDataChannel('diagnostico');
    const done = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      pc.addEventListener('icecandidate', (event) => {
        const c = event.candidate;
        if (!c) {
          clearTimeout(timer);
          resolve();
          return;
        }
        if (
          c.type &&
          c.address &&
          c.port !== null &&
          (c.protocol === 'udp' || c.protocol === 'tcp')
        ) {
          candidates.push({ type: c.type, address: c.address, port: c.port, protocol: c.protocol });
        }
      });
    });
    await pc.setLocalDescription(await pc.createOffer());
    await done;
    return candidates;
  } finally {
    pc.close();
  }
}

/** Diagnóstico completo: cada servidor isolado (quem responde) + coleta conjunta (portas). */
export async function diagnoseNetwork(): Promise<NatDiagnosis> {
  const [first, second, combined] = await Promise.all([
    gatherCandidates([STUN_SERVERS[0] as string]),
    gatherCandidates([STUN_SERVERS[1] as string]),
    gatherCandidates(STUN_SERVERS),
  ]);
  const reachable = [first, second].filter((list) => list.some((c) => c.type === 'srflx')).length;
  return diagnoseNat(combined, reachable);
}
