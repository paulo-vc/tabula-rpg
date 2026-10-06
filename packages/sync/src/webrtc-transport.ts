import { joinRoom } from 'trystero/nostr';
import { MAX_MESSAGE_BYTES } from './protocol';
import type { SyncTransport, TransportHandlers } from './transport';

/** Identifica o app nos relays de sinalização (separa as salas do Tabula das de outros apps). */
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
    if (bytes) handlers?.onMessage(peerId, bytes);
  };

  return {
    send(peerId, data) {
      if (peers.has(peerId)) void channel.send(data, { target: peerId });
    },
    setHandlers(next) {
      handlers = next;
      for (const peerId of peers) next.onPeerJoin(peerId);
      for (const peerId of failures.splice(0)) next.onConnectionFailure?.(peerId);
    },
    leave: () => room.leave(),
  };
}
