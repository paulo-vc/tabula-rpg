import { describe, expect, it } from 'vitest';
import { PORTRAIT_MAX_CHARS, PortraitSchema } from './portrait';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Base64 de teste (o domínio não tem `btoa`). */
function base64(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = bytes.slice(i, i + 3);
    const n = (a << 16) | (b << 8) | c;
    const chars = [18, 12, 6, 0].map((shift) => ALPHABET[(n >> shift) & 63]).join('');
    const missing = 3 - Math.min(3, bytes.length - i);
    out += chars.slice(0, 4 - missing) + '='.repeat(missing);
  }
  return out;
}
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const SVG = [...'<svg xmlns="ht'].map((c) => c.charCodeAt(0));

const portrait = (src: string) => ({ src, width: 300, height: 384 });

describe('PortraitSchema', () => {
  it('aceita WebP e PNG cujo conteúdo bate com o tipo declarado', () => {
    expect(
      PortraitSchema.safeParse(portrait(`data:image/webp;base64,${base64(WEBP)}`)).success,
    ).toBe(true);
    expect(PortraitSchema.safeParse(portrait(`data:image/png;base64,${base64(PNG)}`)).success).toBe(
      true,
    );
  });

  it('lê o tipo de um base64 gerado fora do app', () => {
    // Cabeçalho de WebP em base64, gerado pelo Node.
    const src = 'data:image/webp;base64,UklGRgEAAABXRUJQVlA4IA==';
    expect(PortraitSchema.safeParse(portrait(src)).success).toBe(true);
  });

  it('recusa tipo declarado diferente do conteúdo, SVG e endereços que não são data URL', () => {
    const cases = [
      `data:image/png;base64,${base64(WEBP)}`,
      `data:image/svg+xml;base64,${base64(SVG)}`,
      `data:image/png;base64,${base64(SVG)}`,
      'https://exemplo.com/retrato.png',
      'data:image/png;base64,!!!',
    ];
    for (const src of cases) expect(PortraitSchema.safeParse(portrait(src)).success).toBe(false);
  });

  it('recusa retrato grande demais', () => {
    const big = `data:image/webp;base64,${base64(WEBP)}${'A'.repeat(PORTRAIT_MAX_CHARS)}`;
    expect(PortraitSchema.safeParse(portrait(big)).success).toBe(false);
    const huge = { ...portrait(`data:image/webp;base64,${base64(WEBP)}`), width: 2000 };
    expect(PortraitSchema.safeParse(huge).success).toBe(false);
  });
});
