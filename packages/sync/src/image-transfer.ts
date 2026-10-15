import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { IMAGE_CHUNK_BYTES, MAX_IMAGE_BYTES, sniffImageMime, type Cutscene } from '@tabula/domain';

/** SHA-256 em hexadecimal: identifica uma imagem pelo conteúdo. */
export function hashImage(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** Quantas partes uma imagem desse tamanho tem. */
export const chunkCount = (size: number) => Math.max(1, Math.ceil(size / IMAGE_CHUNK_BYTES));

/** Divide a imagem em partes que cabem numa mensagem da sessão. */
export function chunkImage(bytes: Uint8Array): Uint8Array[] {
  const total = chunkCount(bytes.byteLength);
  return Array.from({ length: total }, (_, index) =>
    bytes.subarray(index * IMAGE_CHUNK_BYTES, (index + 1) * IMAGE_CHUNK_BYTES),
  );
}

/**
 * Junta as partes de UMA imagem esperada (a da cutscene atual). Tudo é conferido: índice,
 * total de partes, tamanho de cada uma e, no fim, tamanho, hash e tipo real do conteúdo.
 * Partes de outra imagem, repetidas ou fora do esperado são ignoradas.
 */
export class ImageAssembler {
  private readonly parts: (Uint8Array | undefined)[];
  private received = 0;
  private done = false;

  constructor(private readonly expected: Pick<Cutscene, 'hash' | 'mime' | 'size'>) {
    this.parts = new Array<Uint8Array | undefined>(chunkCount(expected.size));
  }

  get hash(): string {
    return this.expected.hash;
  }

  /**
   * Acrescenta uma parte. Devolve a imagem quando ela fica completa e confere; `null`
   * enquanto falta algo (ou se a parte foi recusada).
   */
  add(hash: string, index: number, total: number, data: Uint8Array): Uint8Array | null {
    if (this.done || hash !== this.expected.hash || total !== this.parts.length) return null;
    if (!Number.isInteger(index) || index < 0 || index >= total || this.parts[index]) return null;
    const last = index === total - 1;
    const expectedSize = last
      ? this.expected.size - IMAGE_CHUNK_BYTES * (total - 1)
      : IMAGE_CHUNK_BYTES;
    if (data.byteLength !== expectedSize) return null;
    this.parts[index] = data.slice();
    if (++this.received < total) return null;

    this.done = true;
    const bytes = new Uint8Array(this.expected.size);
    let offset = 0;
    for (const part of this.parts as Uint8Array[]) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    const genuine =
      bytes.byteLength <= MAX_IMAGE_BYTES &&
      hashImage(bytes) === this.expected.hash &&
      sniffImageMime(bytes) === this.expected.mime;
    return genuine ? bytes : null;
  }
}
