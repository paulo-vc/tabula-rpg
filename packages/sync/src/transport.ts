/**
 * Porta de transporte da sessão (ADR 0004/0008). O motor de sincronização só conversa por
 * esta interface: o adaptador real é WebRTC (Trystero); nos testes, uma rede em memória.
 * Um relay futuro seria apenas outro adaptador.
 */
export interface TransportHandlers {
  onPeerJoin: (peerId: string) => void;
  onPeerLeave: (peerId: string) => void;
  /** Mensagem recebida de outro participante. Conteúdo NÃO confiável. */
  onMessage: (peerId: string, data: Uint8Array) => void;
}

export interface SyncTransport {
  /** Envia para um participante. Ignorado se ele não estiver conectado. */
  send(peerId: string, data: Uint8Array): void;
  /** Define os tratadores de eventos. Participantes já conectados são anunciados de novo. */
  setHandlers(handlers: TransportHandlers): void;
  /** Sai da sala. */
  leave(): Promise<void>;
}
