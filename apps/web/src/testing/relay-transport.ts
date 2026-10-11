import { MAX_EARLY_MESSAGES, type SyncTransport, type TransportHandlers } from '@tabula/sync';

/**
 * Transporte SÓ PARA OS TESTES DE PONTA A PONTA: em vez de WebRTC com relays Nostr
 * públicos (instáveis num CI), os navegadores do teste conversam por um relay WebSocket
 * local (`apps/e2e/relay-server.ts`). Todo o resto do app (interface, banco, protocolo,
 * assinatura do Mestre, Yjs) é o de verdade.
 *
 * Entra no app só quando o build define `VITE_E2E_RELAY` (ver `main.tsx`).
 *
 * Mensagens do relay (JSON):
 *   servidor → { type: 'peers', ids } | { type: 'join', id } | { type: 'leave', id }
 *            | { type: 'msg', from, data }        (data em base64)
 *   cliente  → { type: 'msg', to, data }
 */
export function createRelayTransport(relayUrl: string) {
  return ({ roomId, secret }: { roomId: string; secret: string }): SyncTransport => {
    let handlers: TransportHandlers | null = null;
    const peers = new Set<string>();
    const pending: string[] = [];
    /** Mensagens que chegaram antes de `setHandlers` (como no transporte WebRTC). */
    const early: [string, Uint8Array][] = [];
    // A sala inclui o segredo, como no transporte real: sem ele, não se encontra a mesa.
    const room = encodeURIComponent(`${roomId}:${secret}`);
    const socket = new WebSocket(`${relayUrl}?room=${room}`);

    socket.addEventListener('open', () => {
      for (const message of pending.splice(0)) socket.send(message);
    });
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as
        | { type: 'peers'; ids: string[] }
        | { type: 'join' | 'leave'; id: string }
        | { type: 'msg'; from: string; data: string };
      if (message.type === 'peers') {
        for (const id of message.ids) {
          peers.add(id);
          handlers?.onPeerJoin(id);
        }
      } else if (message.type === 'join') {
        peers.add(message.id);
        handlers?.onPeerJoin(message.id);
      } else if (message.type === 'leave') {
        peers.delete(message.id);
        handlers?.onPeerLeave(message.id);
      } else if (message.type === 'msg') {
        const bytes = Uint8Array.from(atob(message.data), (char) => char.charCodeAt(0));
        if (handlers) handlers.onMessage(message.from, bytes);
        else if (early.length < MAX_EARLY_MESSAGES) early.push([message.from, bytes]);
      }
    });

    return {
      send(peerId, data) {
        if (!peers.has(peerId)) return;
        let binary = '';
        for (const byte of data) binary += String.fromCharCode(byte);
        const message = JSON.stringify({ type: 'msg', to: peerId, data: btoa(binary) });
        if (socket.readyState === WebSocket.OPEN) socket.send(message);
        else pending.push(message);
      },
      setHandlers(next) {
        handlers = next;
        for (const peerId of peers) next.onPeerJoin(peerId);
        for (const [peerId, bytes] of early.splice(0)) next.onMessage(peerId, bytes);
      },
      async leave() {
        handlers = null;
        peers.clear();
        socket.close();
      },
    };
  };
}
