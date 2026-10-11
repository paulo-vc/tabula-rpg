import { joinRoom } from 'trystero/nostr';
import { MAX_MESSAGE_BYTES } from './protocol';
import {
  MAX_EARLY_MESSAGES,
  type ConnectionInfo,
  type SyncTransport,
  type TransportHandlers,
} from './transport';

/**
 * Identifica o app nos relays de sinalização (separa as nossas salas das de outros apps).
 * Continua com o nome antigo de propósito: mudá-lo separaria a mesa de quem está numa
 * versão anterior à mudança de nome (Tabularium).
 */
export const APP_ID = 'tabula-rpg';

export interface WebRtcRoom {
  /** Sala: o ID da campanha. */
  roomId: string;
  /** Segredo da campanha: cifra os dados de conexão trocados pelos relays públicos. */
  secret: string;
}

/**
 * Transporte real: WebRTC direto entre os navegadores, com sinalização por relays Nostr
 * públicos (Trystero). Sem servidor próprio e sem relay (ADR 0008).
 *
 * Só funciona no navegador; os testes usam `MemoryNetwork`.
 */
export function createWebRtcTransport({ roomId, secret }: WebRtcRoom): SyncTransport {
  let handlers: TransportHandlers | null = null;
  const failures: string[] = [];
  const peers = new Set<string>();
  /** Mensagens que chegaram antes de `setHandlers`: entregues logo depois. */
  const early: [string, Uint8Array][] = [];

  const room = joinRoom(
    { appId: APP_ID, password: secret, maxReceiveBytes: MAX_MESSAGE_BYTES },
    roomId,
    {
      onJoinError: ({ peerId }) => {
        if (handlers?.onConnectionFailure) handlers.onConnectionFailure(peerId);
        else failures.push(peerId); // avisado quando os tratadores forem definidos
      },
    },
  );
  const channel = room.makeAction<Uint8Array>('sessao');

  room.onPeerJoin = (peerId) => {
    peers.add(peerId);
    handlers?.onPeerJoin(peerId);
  };
  room.onPeerLeave = (peerId) => {
    peers.delete(peerId);
    handlers?.onPeerLeave(peerId);
  };
  channel.onMessage = (payload, { peerId }) => {
    // Vem da rede: o formato real depende do navegador (Uint8Array, ArrayBuffer…).
    const data: unknown = payload;
    const bytes =
      data instanceof Uint8Array
        ? data
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : null;
    if (!bytes) return;
    if (handlers) handlers.onMessage(peerId, bytes);
    else if (early.length < MAX_EARLY_MESSAGES) early.push([peerId, bytes]);
  };

  return {
    send(peerId, data) {
      if (peers.has(peerId)) void channel.send(data, { target: peerId });
    },
    setHandlers(next) {
      handlers = next;
      for (const peerId of peers) next.onPeerJoin(peerId);
      for (const peerId of failures.splice(0)) next.onConnectionFailure?.(peerId);
      for (const [peerId, bytes] of early.splice(0)) next.onMessage(peerId, bytes);
    },
    leave: () => room.leave(),
    connectionInfo: async (peerId) => {
      const connection = room.getPeers()[peerId];
      return connection ? readConnectionInfo(connection) : null;
    },
  };
}

/**
 * Lê nas estatísticas do WebRTC o par de candidatos em uso: se a conexão é direta ou passa
 * por um servidor de retransmissão, e a latência de ida e volta.
 */
async function readConnectionInfo(connection: RTCPeerConnection): Promise<ConnectionInfo | null> {
  let stats: RTCStatsReport;
  try {
    stats = await connection.getStats();
  } catch {
    return null;
  }
  const byId = new Map<string, Record<string, unknown>>();
  let selectedPairId: string | undefined;
  stats.forEach((report: Record<string, unknown> & { id: string; type: string }) => {
    byId.set(report.id, report);
    if (report.type === 'transport' && typeof report.selectedCandidatePairId === 'string') {
      selectedPairId = report.selectedCandidatePairId;
    }
  });
  const pair =
    (selectedPairId ? byId.get(selectedPairId) : undefined) ??
    [...byId.values()].find(
      (report) =>
        report.type === 'candidate-pair' &&
        report.state === 'succeeded' &&
        report.nominated === true,
    );
  if (!pair) return null;
  const local = byId.get(String(pair.localCandidateId));
  const remote = byId.get(String(pair.remoteCandidateId));
  const types = [local?.candidateType, remote?.candidateType];
  const path: ConnectionInfo['path'] = types.includes('relay') ? 'retransmitida' : 'direta';
  const rtt = pair.currentRoundTripTime;
  return { path, rttMs: typeof rtt === 'number' ? Math.round(rtt * 1000) : null };
}
