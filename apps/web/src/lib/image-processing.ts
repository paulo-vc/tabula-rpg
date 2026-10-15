import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, sniffImageMime, type ImageMime } from '@tabula/domain';

export interface ProcessedImage {
  data: Uint8Array;
  mime: ImageMime;
  width: number;
  height: number;
}

/** Reduz e converte uma imagem escolhida pelo usuário (injetável: nos testes, uma falsa). */
export type ImageProcessor = (file: Blob) => Promise<ProcessedImage>;

/** Arquivos maiores que isso nem são abertos (fotos de celular costumam ter 3 a 8 MB). */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** Tentativas, da melhor qualidade para a menor, até caber em `MAX_IMAGE_BYTES`. */
const ATTEMPTS = [
  { side: MAX_IMAGE_SIDE, quality: 0.85 },
  { side: MAX_IMAGE_SIDE, quality: 0.7 },
  { side: 1280, quality: 0.7 },
  { side: 960, quality: 0.6 },
];

/**
 * Redimensiona (lado maior até 1600 px) e converte para WebP (JPEG se o navegador não gera
 * WebP). O resultado é sempre um bitmap novo: metadados e qualquer conteúdo embutido no
 * arquivo original ficam para trás, e o tipo final é conferido pelos primeiros bytes.
 */
export const processImage: ImageProcessor = async (file) => {
  if (file.size > MAX_INPUT_BYTES) throw new Error('A imagem é grande demais (até 25 MB).');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Não foi possível abrir a imagem. Use PNG, JPEG ou WebP.');
  }
  try {
    for (const { side, quality } of ATTEMPTS) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('O navegador não conseguiu processar a imagem.');
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', quality),
      );
      if (!blob || blob.size > MAX_IMAGE_BYTES) continue;
      const data = new Uint8Array(await blob.arrayBuffer());
      const mime = sniffImageMime(data);
      if (mime) return { data, mime, width, height };
    }
    throw new Error('A imagem não ficou pequena o bastante. Tente outra.');
  } finally {
    bitmap.close();
  }
};
