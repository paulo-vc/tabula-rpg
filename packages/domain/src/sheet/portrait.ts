import { z } from 'zod';
import { sniffImageMime } from '../cutscene/schema';

/** Lado maior do retrato depois de reduzido. */
export const PORTRAIT_MAX_SIDE = 384;
/**
 * Tamanho máximo do retrato (data URL). Vai junto com a ficha para o Mestre, numa mensagem
 * da sessão de até 512 KB: o retrato precisa caber com folga ao lado dos valores.
 */
export const PORTRAIT_MAX_CHARS = 120_000;

const DATA_URL = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Os primeiros 12 bytes de um base64 (16 caracteres), sem decodificar o resto. */
function headBytes(base64: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i + 4 <= Math.min(16, base64.length); i += 4) {
    const [a, b, c, d] = [...base64.slice(i, i + 4)].map((char) => ALPHABET.indexOf(char));
    if (a === undefined || b === undefined || c === undefined || d === undefined) break;
    if (a < 0 || b < 0) break;
    bytes.push((a << 2) | (b >> 4));
    if (c >= 0) bytes.push(((b & 15) << 4) | (c >> 2));
    if (c >= 0 && d >= 0) bytes.push(((c & 3) << 6) | d);
  }
  return Uint8Array.from(bytes);
}

/**
 * Retrato do personagem, embutido na ficha (data URL). Vem também de outros participantes
 * e de arquivos importados: só PNG, JPEG ou WebP (nunca SVG), e o tipo declarado precisa
 * bater com os primeiros bytes.
 */
export const PortraitSchema = z.object({
  src: z
    .string()
    .max(PORTRAIT_MAX_CHARS)
    .refine((src) => {
      const match = DATA_URL.exec(src);
      if (!match?.[1] || !match[2]) return false;
      return sniffImageMime(headBytes(match[2])) === match[1];
    }, 'Retrato inválido'),
  width: z.number().int().min(1).max(PORTRAIT_MAX_SIDE),
  height: z.number().int().min(1).max(PORTRAIT_MAX_SIDE),
});
export type Portrait = z.infer<typeof PortraitSchema>;
