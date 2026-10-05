import { joinRoom, type Room } from 'trystero/nostr';
import { describeConnection, type ConnectionInfo, type StatsEntry } from './connection';

export const APP_ID = 'tabula-rpg-teste-conexao';

export type PeerState =
  | { status: 'conectado'; name: string; seconds: number; connection: ConnectionInfo | null }
  | { status: 'saiu'; name: string; seconds: number; connection: ConnectionInfo | null };

export interface RoomEvents {
  onPeersChange: (peers: ReadonlyMap<string, PeerState>) => void;
  /** Dois navegadores trocaram dados de conexão, mas o WebRTC não conseguiu conectar direto. */
  onDirectFailure: (failures: number) => void;
}

/**
 * Entra numa sala de teste. A sinalização usa relays Nostr públicos (sem servidor nosso);
 * o código da sala também é a senha que cifra os dados de conexão trocados por eles.
 */
export function joinTestRoom(
  code: string,
  name: string,
  events: RoomEvents,
): { leave: () => Promise<void> } {
  const startedAt = performance.now();
  const peers = new Map<string, PeerState>();
  const failedPeers = new Set<string>();
  const emit = () => events.onPeersChange(new Map(peers));

  const room: Room = joinRoom({ appId: APP_ID, password: code }, code, {
    onJoinError: ({ peerId, error }) => {
      console.warn('Falha de conexão direta', peerId, error);
      failedPeers.add(peerId);
      events.onDirectFailure(failedPeers.size);
    },
  });

  const hello = room.makeAction<{ name: string }>('ola');

  const measure = async (peerId: string) => {
    const pc = room.getPeers()[peerId];
    if (!pc) return;
    const stats = await pc.getStats();
    const entries: StatsEntry[] = [];
    stats.forEach((entry: StatsEntry) => entries.push(entry));
    const current = peers.get(peerId);
    if (current) {
      peers.set(peerId, { ...current, connection: describeConnection(entries) });
      emit();
    }
  };

  room.onPeerJoin = (peerId) => {
    const seconds = (performance.now() - startedAt) / 1000;
    peers.set(peerId, {
      status: 'conectado',
      name: `participante ${peerId.slice(0, 4)}`,
      seconds,
      connection: null,
    });
    emit();
    void hello.send({ name }, { target: peerId });
    // O par de candidatos em uso só aparece nas estatísticas logo após a conexão.
    setTimeout(() => void measure(peerId), 1500);
    setTimeout(() => void measure(peerId), 5000);
  };

  room.onPeerLeave = (peerId) => {
    const current = peers.get(peerId);
    if (current) peers.set(peerId, { ...current, status: 'saiu' });
    emit();
  };

  hello.onMessage = (data, context) => {
    const current = peers.get(context.peerId);
    if (current && typeof data.name === 'string') {
      peers.set(context.peerId, { ...current, name: data.name.slice(0, 40) || current.name });
      emit();
    }
  };

  return { leave: () => room.leave() };
}
