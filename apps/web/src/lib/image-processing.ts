import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, sniffImageMime, type ImageMime } from '@tabula/domain';

export interface ProcessedImage {
  data: Uint8Array;
  mime: ImageMime;
  width: number;
  height: number;
}

/** Até onde reduzir: lado maior e tamanho final. */
export interface ImageLimits {
  maxSide: number;
  maxBytes: number;
}

/** Imagens da cutscene: em tela cheia, até 1600 px e 2 MB. */
export const CUTSCENE_LIMITS: ImageLimits = { maxSide: MAX_IMAGE_SIDE, maxBytes: MAX_IMAGE_BYTES };

/** Reduz e converte uma imagem escolhida pelo usuário (injetável: nos testes, uma falsa). */
export type ImageProcessor = (file: Blob, limits?: ImageLimits) => Promise<ProcessedImage>;

/** Arquivos maiores que isso nem são abertos (fotos de celular costumam ter 3 a 8 MB). */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** Tentativas, da melhor qualidade para a menor, até caber no tamanho máximo. */
const ATTEMPTS = [
  { scale: 1, quality: 0.85 },
  { scale: 1, quality: 0.7 },
  { scale: 0.8, quality: 0.7 },
  { scale: 0.6, quality: 0.6 },
];

/**
 * Redimensiona (lado maior até `limits.maxSide`, 1600 px na cutscene) e converte para WebP (JPEG se o navegador não gera
 * WebP). O resultado é sempre um bitmap novo: metadados e qualquer conteúdo embutido no
 * arquivo original ficam para trás, e o tipo final é conferido pelos primeiros bytes.
 */
export const processImage: ImageProcessor = async (file, limits = CUTSCENE_LIMITS) => {
  if (file.size > MAX_INPUT_BYTES) throw new Error('A imagem é grande demais (até 25 MB).');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Não foi possível abrir a imagem. Use PNG, JPEG ou WebP.');
  }
  try {
    for (const attempt of ATTEMPTS) {
      const side = Math.round(limits.maxSide * attempt.scale);
      const { quality } = attempt;
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
      if (!blob || blob.size > limits.maxBytes) continue;
      const data = new Uint8Array(await blob.arrayBuffer());
      const mime = sniffImageMime(data);
      if (mime) return { data, mime, width, height };
    }
    throw new Error('A imagem não ficou pequena o bastante. Tente outra.');
  } finally {
    bitmap.close();
  }
};
