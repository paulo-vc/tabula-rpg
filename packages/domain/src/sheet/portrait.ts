import type { z } from 'zod';
import { embeddedImageSchema } from '../image/embedded';

/** Lado maior do retrato depois de reduzido. */
export const PORTRAIT_MAX_SIDE = 384;
/**
 * Tamanho máximo do retrato (data URL). Vai junto com a ficha para o Mestre, numa mensagem
 * da sessão de até 512 KB: o retrato precisa caber com folga ao lado dos valores.
 */
export const PORTRAIT_MAX_CHARS = 120_000;

/** Retrato do personagem, embutido na ficha. */
export const PortraitSchema = embeddedImageSchema({
  maxChars: PORTRAIT_MAX_CHARS,
  maxSide: PORTRAIT_MAX_SIDE,
});
export type Portrait = z.infer<typeof PortraitSchema>;
