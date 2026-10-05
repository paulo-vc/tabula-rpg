import { CONNECTION_LABEL, type ConnectionInfo } from './connection';
import { NAT_DESCRIPTION, type NatDiagnosis } from './nat';

/** Caracteres sem ambiguidade (sem 0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Código de sala legível, ex.: "K7QM-XR4P". Também é a senha que cifra a troca de dados de
 * conexão, por isso usa aleatoriedade criptográfica sem viés (bytes acima do último múltiplo
 * do alfabeto são descartados).
 */
export function newRoomCode(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  const limit = 256 - (256 % ALPHABET.length);
  const chars: string[] = [];
  while (chars.length < 8) {
    for (const byte of random(new Uint8Array(16))) {
      if (byte < limit && chars.length < 8) chars.push(ALPHABET[byte % ALPHABET.length] as string);
    }
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** Normaliza o que o usuário digitou: "k7qm xr4p" → "K7QM-XR4P". `null` se inválido. */
export function normalizeRoomCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 8 || [...clean].some((c) => !ALPHABET.includes(c))) return null;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

export interface PeerResult {
  name: string;
  outcome: { ok: true; connection: ConnectionInfo | null; seconds: number } | { ok: false };
}

export interface ReportInput {
  name: string;
  network: string;
  nat: NatDiagnosis | null;
  roomCode: string | null;
  peers: readonly PeerResult[];
  failures: number;
  userAgent: string;
}

function browserName(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return 'Edge';
  if (/OPR\//.test(userAgent)) return 'Opera';
  if (/Firefox\//.test(userAgent)) return 'Firefox';
  if (/Chrome\//.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return 'outro';
}

/** Resumo em texto para colar no chat. Não inclui endereços IP. */
export function formatReport(input: ReportInput): string {
  const lines = [
    '== Tabula RPG — teste de conexão ==',
    `Participante: ${input.name || '(sem nome)'}`,
    `Rede: ${input.network || '(não informada)'}`,
    `Navegador: ${browserName(input.userAgent)}`,
  ];
  if (input.nat) {
    lines.push(
      `NAT: ${input.nat.natType} — ${NAT_DESCRIPTION[input.nat.natType]}`,
      `IPv6 público: ${input.nat.ipv6 ? 'sim' : 'não'}`,
    );
  }
  if (input.roomCode) {
    lines.push(`Sala: ${input.roomCode}`);
    for (const peer of input.peers) {
      if (!peer.outcome.ok) {
        lines.push(`- ${peer.name}: FALHOU`);
        continue;
      }
      const c = peer.outcome.connection;
      const detail = c
        ? `${CONNECTION_LABEL[c.kind]}${c.ipVersion ? `, IPv${c.ipVersion}` : ''}${c.rttMs !== null ? `, ${c.rttMs} ms` : ''}`
        : 'conectado';
      lines.push(`- ${peer.name}: ${detail} (em ${peer.outcome.seconds.toFixed(1)} s)`);
    }
    if (input.failures > 0) lines.push(`Falhas de conexão direta: ${input.failures}`);
    if (input.peers.length === 0 && input.failures === 0) lines.push('- ninguém conectou');
  }
  return lines.join('\n');
}
