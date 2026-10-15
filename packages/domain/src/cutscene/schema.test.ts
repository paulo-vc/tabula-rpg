import { describe, expect, it } from 'vitest';
import { CutsceneSchema, MAX_IMAGE_BYTES, sniffImageMime } from './schema';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe('tipo real da imagem', () => {
  it('reconhece PNG, JPEG e WebP pelos primeiros bytes', () => {
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe('image/png');
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    const webp = ascii('RIFF____WEBPVP8 ');
    expect(sniffImageMime(webp)).toBe('image/webp');
  });

  it('recusa SVG, HTML, GIF e bytes curtos', () => {
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg">', '<!doctype html>', 'GIF89a']) {
      expect(sniffImageMime(ascii(text))).toBeNull();
    }
    expect(sniffImageMime(bytes())).toBeNull();
    expect(sniffImageMime(bytes(0xff))).toBeNull();
  });
});

describe('cutscene', () => {
  const valid = {
    hash: 'a'.repeat(64),
    mime: 'image/webp',
    size: 1000,
    width: 1600,
    height: 900,
    title: 'O dragão',
    caption: '',
  };

  it('aceita o formato e recusa tipo, tamanho ou hash fora do esperado', () => {
    expect(CutsceneSchema.safeParse(valid).success).toBe(true);
    expect(CutsceneSchema.safeParse({ ...valid, mime: 'image/svg+xml' }).success).toBe(false);
    expect(CutsceneSchema.safeParse({ ...valid, size: MAX_IMAGE_BYTES + 1 }).success).toBe(false);
    expect(CutsceneSchema.safeParse({ ...valid, hash: 'xyz' }).success).toBe(false);
  });
});
