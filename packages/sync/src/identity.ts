import { ed25519 } from '@noble/curves/ed25519.js';

/**
 * Identidade do Mestre (Ed25519). Cada campanha tem um par de chaves: a pública viaja no
 * convite e a privada nunca sai do aparelho do Mestre. O Mestre prova quem é assinando um
 * desafio aleatório escolhido pelo jogador, o que impede que alguém que só tem o convite
 * se passe por ele, e impede o reaproveitamento de provas antigas (replay).
 */

export interface GmKeyPair {
  /** Chave pública, base64url (43 caracteres). Vai no convite. */
  publicKey: string;
  /** Chave privada, base64url (43 caracteres). Fica só no aparelho do Mestre. */
  secretKey: string;
}

const PROOF_CONTEXT = 'tabula/gm-proof/1';

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @returns `null` se o texto não for base64url válido. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export function generateGmKeyPair(): GmKeyPair {
  const { secretKey, publicKey } = ed25519.keygen();
  return { publicKey: toBase64Url(publicKey), secretKey: toBase64Url(secretKey) };
}

/** Desafio aleatório de 128 bits, escolhido por quem quer verificar o Mestre. */
export function newChallenge(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

/** O que o Mestre assina: amarra a prova à campanha, ao desafio e ao ID do Mestre. */
function proofMessage(campaignId: string, challenge: string, gmId: string): Uint8Array {
  return new TextEncoder().encode(`${PROOF_CONTEXT}\n${campaignId}\n${challenge}\n${gmId}`);
}

/** Assina o desafio de um jogador. */
export function signChallenge(
  secretKey: string,
  campaignId: string,
  challenge: string,
  gmId: string,
): string {
  const key = fromBase64Url(secretKey);
  if (key?.length !== 32) throw new Error('Chave privada do Mestre inválida.');
  return toBase64Url(ed25519.sign(proofMessage(campaignId, challenge, gmId), key));
}

/** Confere a prova do Mestre. Qualquer entrada malformada resulta em `false`. */
export function verifyChallenge(
  publicKey: string,
  proof: string,
  campaignId: string,
  challenge: string,
  gmId: string,
): boolean {
  const key = fromBase64Url(publicKey);
  const signature = fromBase64Url(proof);
  if (key?.length !== 32 || signature?.length !== 64) return false;
  try {
    return ed25519.verify(signature, proofMessage(campaignId, challenge, gmId), key);
  } catch {
    return false;
  }
}
