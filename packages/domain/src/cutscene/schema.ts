import { z } from 'zod';
import { IdSchema, LabelSchema, TimestampSchema } from '../schema/primitives';

/**
 * Imagens da cutscene: o Mestre as guarda na campanha e as mostra em tela cheia para a mesa.
 * Só formatos de bitmap (nunca SVG, que pode conter script) e com tamanho limitado: a imagem
 * vai aos jogadores em partes pela conexão direta.
 */
export const IMAGE_MIMES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];

/** Tamanho máximo de uma imagem guardada (já reduzida). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Tamanho de cada parte enviada (uma mensagem da sessão tem até 512 KB). */
export const IMAGE_CHUNK_BYTES = 256 * 1024;
export const MAX_IMAGE_CHUNKS = Math.ceil(MAX_IMAGE_BYTES / IMAGE_CHUNK_BYTES);
/** Lado maior da imagem depois de reduzida. */
export const MAX_IMAGE_SIDE = 1600;

/** SHA-256 em hexadecimal: identifica a imagem pelo conteúdo. */
export const ImageHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** O que a mesa recebe ao ver uma imagem: o conteúdo vem à parte, conferido pelo hash. */
export const CutsceneSchema = z.object({
  hash: ImageHashSchema,
  mime: z.enum(IMAGE_MIMES),
  size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
  title: z.string().trim().max(100),
  caption: z.string().max(500),
});
export type Cutscene = z.infer<typeof CutsceneSchema>;

/** Imagem da galeria do Mestre (ou recebida pelo jogador, guardada para não baixar de novo). */
export const StoredImageSchema = CutsceneSchema.extend({
  id: IdSchema,
  /** `galeria`: do Mestre; `recebida`: guardada pelo jogador ao ver a cutscene. */
  origin: z.enum(['galeria', 'recebida']),
  createdAt: TimestampSchema,
});
export type StoredImage = z.infer<typeof StoredImageSchema>;

/** Título obrigatório só na galeria (na cutscene pode ficar vazio). */
export const GalleryTitleSchema = LabelSchema;

/**
 * Confere o tipo real pelos primeiros bytes (não pelo nome do arquivo nem pelo que o outro
 * lado declara). `null` se não for PNG, JPEG nem WebP.
 */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  const riff = at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46;
  const webp = at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50;
  return riff && webp ? 'image/webp' : null;
}
