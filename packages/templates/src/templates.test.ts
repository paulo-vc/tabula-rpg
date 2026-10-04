import {
  compileTemplate,
  computeDerived,
  createSheet,
  type CompiledTemplate,
  type LayoutNode,
  type SystemTemplate,
} from '@tabula/domain';
import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from './index';

function compile(template: SystemTemplate): CompiledTemplate {
  const result = compileTemplate(template);
  if (!result.ok) throw new Error(result.error.map((i) => i.message).join('\n'));
  return result.value;
}

const layoutFieldIds = (nodes: readonly LayoutNode[]): string[] =>
  nodes.flatMap((node) => (node.kind === 'field' ? [node.fieldId] : layoutFieldIds(node.children)));

describe.each(BUILTIN_TEMPLATES.map((template) => [template.id, template] as const))(
  'template nativo %s',
  (_, template) => {
    it('compila sem problemas', () => {
      expect(compileTemplate(template)).toMatchObject({ ok: true });
    });

    it('é marcado como nativo e tem licença', () => {
      expect(template.source).toBe('builtin');
      expect(template.license).toBeTruthy();
    });

    it('exibe todos os campos no layout completo', () => {
      const shown = new Set(layoutFieldIds(template.layouts.full));
      const missing = template.fields.filter((field) => !shown.has(field.id)).map((f) => f.id);
      expect(missing).toEqual([]);
    });

    it('calcula uma ficha nova sem erros', () => {
      const compiled = compile(template);
      const sheet = createSheet(compiled, { id: 's', name: 'Teste', ownerId: 'u', now: 0 });
      const { computed, resourceMax } = computeDerived(compiled, sheet.values);
      const failures = Object.entries({ ...computed, ...resourceMax }).filter(([, r]) => !r.ok);
      expect(failures).toEqual([]);
    });
  },
);

describe('D&D 5e (SRD)', () => {
  const template = getBuiltinTemplate('dnd5e-srd');
  if (!template) throw new Error('template ausente');
  const compiled = compile(template);

  it('inclui a atribuição exigida pela licença CC-BY-4.0', () => {
    expect(template.license).toBe('CC-BY-4.0');
    expect(template.description).toContain('System Reference Document 5.1');
    expect(template.description).toContain('Wizards of the Coast');
  });

  it('calcula um guerreiro de nível 5 como no livro', () => {
    const sheet = createSheet(compiled, { id: 's', name: 'Guerreira', ownerId: 'u', now: 0 });
    const values = {
      ...sheet.values,
      nivel: 5,
      for: 16,
      des: 14,
      con: 15,
      int: 8,
      sab: 12,
      car: 10,
      prof_salv_for: true,
      prof_salv_con: true,
      prof_atletismo: true,
      prof_percepcao: true,
      esp_percepcao: true, // especialização dobra a proficiência
      prof_furtividade: false,
      esp_furtividade: true, // especialização sem proficiência não tem efeito
    };
    const { computed } = computeDerived(compiled, values);
    const value = (id: string) => {
      const result = computed[id];
      return result?.ok ? result.value : result;
    };

    expect(value('bonus_prof')).toBe(3);
    expect(value('for_mod')).toBe(3);
    expect(value('int_mod')).toBe(-1);
    expect(value('salv_for')).toBe(6); // 3 + 3
    expect(value('salv_des')).toBe(2); // sem proficiência
    expect(value('atletismo')).toBe(6); // 3 + 3
    expect(value('percepcao')).toBe(7); // 1 + 3 × 2
    expect(value('furtividade')).toBe(2);
    expect(value('percepcao_passiva')).toBe(17);
    expect(value('iniciativa')).toBe(2);
  });

  it('calcula o bônus de proficiência em todos os níveis', () => {
    const expected = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];
    expected.forEach((bonus, index) => {
      const { computed } = computeDerived(compiled, { nivel: index + 1 });
      expect(computed.bonus_prof).toEqual({ ok: true, value: bonus });
    });
  });
});
