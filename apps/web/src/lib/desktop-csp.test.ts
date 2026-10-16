import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A política de segurança (CSP) do app desktop vale só lá: no navegador e nos testes, nada
 * a aplica. Este teste confere que ela permite o que o app usa, para não descobrir só no
 * app instalado (como as imagens da cutscene na v0.3.0).
 */
const config = JSON.parse(
  // Os testes rodam a partir de apps/web (e o jsdom não dá o caminho do arquivo).
  readFileSync(resolve(process.cwd(), '../desktop/src-tauri/tauri.conf.json'), 'utf8'),
) as { app: { security: { csp: string } } };

function directive(name: string): string[] {
  const found = config.app.security.csp
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([directiveName]) => directiveName === name);
  return found?.slice(1) ?? [];
}

describe('CSP do app desktop', () => {
  it('mostra imagens guardadas no aparelho (galeria e cutscene usam blob:)', () => {
    expect(directive('img-src')).toContain('blob:');
  });

  it('mostra os retratos dos personagens (data URL dentro da ficha)', () => {
    expect(directive('img-src')).toContain('data:');
  });

  it('não libera scripts de fora', () => {
    expect(directive('script-src')).toEqual([]);
    expect(directive('default-src')).toEqual(["'self'"]);
  });
});
