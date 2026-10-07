import {
  compileTemplate,
  computeDerived,
  createSheet,
  emptyIndex,
  prepareSubmission,
  type SystemTemplate,
} from '@tabula/domain';
import { describe, expect, it } from 'vitest';
import dualidade from '../community/dualidade.json';
import { BUILTIN_TEMPLATES } from './index';

const COMMUNITY: SystemTemplate[] = [dualidade as SystemTemplate];

describe.each(COMMUNITY.map((template) => [template.id, template] as const))(
  'sistema da comunidade %s',
  (_, template) => {
    it('passa pelas regras de publicação do repositório', () => {
      const result = prepareSubmission(JSON.stringify(template), {
        index: emptyIndex('2026-10-08T00:00:00.000Z'),
        submitter: 'paulo-vc',
        builtinIds: BUILTIN_TEMPLATES.map((t) => t.id),
      });
      expect(result).toMatchObject({ ok: true, value: { source: 'community' } });
    });

    it('não vem embutido no app', () => {
      expect(BUILTIN_TEMPLATES.some((t) => t.id === template.id)).toBe(false);
    });
  },
);

describe('Dualidade (compatível com Daggerheart)', () => {
  const template = dualidade as SystemTemplate;
  const compiled = (() => {
    const result = compileTemplate(template);
    if (!result.ok) throw new Error(result.error.map((i) => i.message).join('\n'));
    return result.value;
  })();
  const base = createSheet(compiled, { id: 's', name: 'Teste', ownerId: 'u', now: 0 }).values;
  const calc = (values: Record<string, unknown>) => {
    const { computed, resourceMax } = computeDerived(compiled, { ...base, ...values } as never);
    const read = (result: { ok: boolean; value?: number } | undefined) =>
      result?.ok ? result.value : 'erro';
    return {
      value: (id: string) => read(computed[id] as never),
      max: (id: string) => read(resourceMax[id] as never),
    };
  };

  it('segue a DPCGL: sem a marca no título e com a atribuição exigida', () => {
    expect(template.name).not.toMatch(/daggerheart/i);
    expect(template.license).toBe('DPCGL');
    expect(template.description).toContain('Daggerheart System Reference Document 1.0');
    expect(template.description).toContain('Darrington Press Community Gaming License');
  });

  it('patamar acompanha o nível', () => {
    expect([1, 2, 4, 5, 7, 8, 10].map((nivel) => calc({ nivel }).value('patamar'))).toEqual([
      1, 2, 2, 3, 3, 4, 4,
    ]);
  });

  it('limiares somam o nível; efeitos alteram Evasão e traços', () => {
    const item = (id: string, values: Record<string, unknown>) => ({ id, values });
    const { value, max } = calc({
      nivel: 3,
      limiar_maior_base: 7,
      limiar_grave_base: 15,
      armadura_base: 4,
      agilidade_base: 2,
      efeitos: [
        item('e1', { nome: 'Esquiva', alvo: 'evasao', valor: 1, ativo: true }),
        item('e2', { nome: 'Bênção', alvo: 'testes', valor: 1, ativo: false }),
      ],
    });
    expect(value('limiar_maior')).toBe(10);
    expect(value('limiar_grave')).toBe(18);
    expect(value('evasao')).toBe(11);
    expect(value('agilidade')).toBe(2);
    expect(max('espacos_armadura')).toBe(4);
    expect(max('esperanca')).toBe(6);
  });
});
