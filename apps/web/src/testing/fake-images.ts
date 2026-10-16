import { sniffImageMime } from '@tabula/domain';
import type { ImageProcessor } from '@/lib/image-processing';

/** "PNG" de teste: cabeçalho de PNG e o resto pseudoaleatório (o conteúdo não importa). */
export function fakePng(size = 600_000, seed = 7): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i++) bytes[i] = (x = (x * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  return bytes;
}

/** Nos testes não há canvas: a "redução" devolve os bytes como estão. */
export const fakeProcessImage: ImageProcessor = async (file, limits) => {
  // Cópia para um buffer deste contexto: o do `File` do jsdom não é clonado direito pelo
  // IndexedDB simulado (viraria um objeto comum).
  const data = Uint8Array.from(new Uint8Array(await file.arrayBuffer()));
  const mime = sniffImageMime(data);
  if (!mime) throw new Error('Não foi possível abrir a imagem. Use PNG, JPEG ou WebP.');
  const side = Math.min(1600, limits?.maxSide ?? 1600);
  return { data, mime, width: side, height: Math.round((side * 9) / 16) };
};
