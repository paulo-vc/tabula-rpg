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
  /**
   * Dois participantes se encontraram, mas a conexão direta não abriu (rede restritiva).
   * Sem relay (ADR 0008), a interface deve explicar isso ao usuário.
   */
  onConnectionFailure?: (peerId: string) => void;
}

/**
 * Quantas mensagens um transporte guarda enquanto ninguém escuta (antes de `setHandlers`).
 * Ex.: o app entra na sala e ainda está lendo o banco quando o primeiro HELLO chega.
 */
export const MAX_EARLY_MESSAGES = 100;

/**
 * Como a conexão com um participante está passando:
 * - `direta`: de um aparelho ao outro (na mesma rede ou entre redes);
 * - `retransmitida`: por um servidor de retransmissão (TURN).
 *
 * "Mesma rede" não é distinguida: o navegador esconde os endereços locais (mDNS), e cada
 * lado classificaria a mesma conexão de um jeito.
 */
export interface ConnectionInfo {
  path: 'direta' | 'retransmitida';
  /** Ida e volta, em milissegundos (`null` se o navegador ainda não mediu). */
  rttMs: number | null;
}

export interface SyncTransport {
  /** Envia para um participante. Ignorado se ele não estiver conectado. */
  send(peerId: string, data: Uint8Array): void;
  /** Define os tratadores de eventos. Participantes já conectados são anunciados de novo. */
  setHandlers(handlers: TransportHandlers): void;
  /** Sai da sala. */
  leave(): Promise<void>;
  /** Caminho e latência da conexão com um participante (se o transporte souber medir). */
  connectionInfo?(peerId: string): Promise<ConnectionInfo | null>;
}
