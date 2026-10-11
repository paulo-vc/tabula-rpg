import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * Relay local dos testes de ponta a ponta: faz o papel da sinalização + WebRTC, repassando
 * as mensagens entre os navegadores da mesma sala. O app usa o transporte
 * `apps/web/src/testing/relay-transport.ts` quando é construído com `VITE_E2E_RELAY`.
 *
 * Roda direto no Node 24 (`node relay-server.ts`), sem etapa de build.
 */
const port = Number(process.env.E2E_RELAY_PORT ?? 4510);
const rooms = new Map<string, Map<string, WebSocket>>();
const server = new WebSocketServer({ port, maxPayload: 1024 * 1024 });

server.on('connection', (socket, request) => {
  const room = new URL(request.url ?? '/', 'http://relay').searchParams.get('room') ?? '';
  const members = rooms.get(room) ?? new Map<string, WebSocket>();
  rooms.set(room, members);
  const id = randomUUID();

  const sendTo = (target: WebSocket, message: object) => target.send(JSON.stringify(message));
  sendTo(socket, { type: 'peers', ids: [...members.keys()] });
  for (const other of members.values()) sendTo(other, { type: 'join', id });
  members.set(id, socket);

  socket.on('message', (raw) => {
    let message: { type?: unknown; to?: unknown; data?: unknown };
    try {
      message = JSON.parse(String(raw)) as typeof message;
    } catch {
      return;
    }
    if (message.type !== 'msg' || typeof message.to !== 'string') return;
    if (typeof message.data !== 'string') return;
    const target = members.get(message.to);
    if (target) sendTo(target, { type: 'msg', from: id, data: message.data });
  });

  socket.on('close', () => {
    members.delete(id);
    for (const other of members.values()) sendTo(other, { type: 'leave', id });
    if (members.size === 0) rooms.delete(room);
  });
});

console.log(`Relay de teste em ws://localhost:${port}`);
