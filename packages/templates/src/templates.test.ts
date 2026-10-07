import {
  compileTemplate,
  computeDerived,
  createSheet,
  migrateSheet,
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

describe('D&D 5e: fórmulas avançadas (1.1.0)', () => {
  const template = getBuiltinTemplate('dnd5e-srd');
  if (!template) throw new Error('template ausente');
  const compiled = compile(template);
  const base = createSheet(compiled, { id: 's', name: 'Teste', ownerId: 'u', now: 0 }).values;
  const calc = (values: Record<string, unknown>) => {
    const { computed } = computeDerived(compiled, { ...base, ...values } as never);
    return (id: string) => {
      const result = computed[id];
      return result?.ok ? result.value : result;
    };
  };
  const item = (id: string, values: Record<string, unknown>) => ({ id, values });

  it('CA total soma a base, os itens equipados e os efeitos de CA ativos', () => {
    const value = calc({
      ca: 16,
      equipamento: [
        item('escudo', { nome: 'Escudo', bonus_ca: 2, equipado: true }),
        item('anel', { nome: 'Anel de Proteção', bonus_ca: 1, equipado: false }),
      ],
      efeitos: [
        item('e1', { nome: 'Escudo da Fé', alvo: 'ca', valor: 2, ativo: true }),
        item('e2', { nome: 'Bênção (resist.)', alvo: 'resistencias', valor: 1, ativo: true }),
        item('e3', { nome: 'Antigo', alvo: 'ca', valor: 5, ativo: false }),
      ],
    });
    expect(value('ca_total')).toBe(20); // 16 + 2 (escudo) + 2 (Escudo da Fé)
    expect(value('salv_for')).toBe(1); // 0 + efeito de resistência
    expect(value('atletismo')).toBe(0); // efeito de resistência não afeta perícia
  });

  it('CD de magia usa o atributo de conjuração escolhido', () => {
    const value = calc({ nivel: 5, int: 18, sab: 12, atributo_conjuracao: 'int' });
    expect(value('mod_conjuracao')).toBe(4);
    expect(value('cd_magia')).toBe(15); // 8 + 3 + 4
    expect(value('ataque_magia')).toBe(7);
    expect(calc({ nivel: 5, int: 18, sab: 12, atributo_conjuracao: 'sab' })('cd_magia')).toBe(12);
    expect(calc({ nivel: 5 })('cd_magia')).toBe(11); // nenhum escolhido: só 8 + proficiência
  });

  it('carga, capacidade e magias preparadas', () => {
    const value = calc({
      for: 15,
      equipamento: [item('corda', { qtd: 1, peso: 5 }), item('racao', { qtd: 10, peso: 1 })],
      magias: [
        item('m1', { nome: 'Mísseis Mágicos', preparada: true }),
        item('m2', { nome: 'Escudo', preparada: true }),
        item('m3', { nome: 'Sono', preparada: false }),
      ],
    });
    expect(value('carga')).toBe(15);
    expect(value('capacidade_carga')).toBe(102);
    expect(value('magias_preparadas')).toBe(2);
  });

  it('migra uma ficha da 1.0.0: valores mantidos, o modificador digitado vira calculado', () => {
    const old = {
      ...createSheet(compiled, { id: 's', name: 'Antiga', ownerId: 'u', now: 0 }),
      templateRef: { id: 'dnd5e-srd', version: '1.0.0', source: 'builtin' as const },
    };
    old.values = { ...old.values, for: 17, mod_conjuracao: 3 } as never;
    delete (old.values as Record<string, unknown>).atributo_conjuracao;
    const { sheet, report } = migrateSheet(old, compiled, 1);
    expect(sheet.templateRef.version).toBe('1.1.0');
    expect(sheet.values.for).toBe(17);
    expect(report.orphaned).toEqual(['mod_conjuracao']); // guardado, não perdido
    expect(sheet.orphaned).toEqual({ mod_conjuracao: 3 });
  });
});

describe('Lendas d20 (ORC)', () => {
  const template = getBuiltinTemplate('lendas-d20-orc');
  if (!template) throw new Error('template ausente');
  const compiled = compile(template);
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

  it('traz o aviso da licença ORC e não usa marcas da Paizo', () => {
    expect(template.license).toBe('ORC');
    expect(template.description).toContain('ORC License');
    expect(template.description).toContain('TX 9-307-067');
    expect(template.description).toContain('Player Core © 2023 Paizo Inc.');
    const visible = JSON.stringify({ ...template, description: '' });
    expect(visible).not.toMatch(/pathfinder|golarion/i);
  });

  it('proficiência: grau + nível se treinado; só o atributo se destreinado', () => {
    const { value } = calc({ nivel: 5, for: 4, prof_atletismo: 'treinado' });
    expect(value('atletismo')).toBe(4 + 2 + 5);
    expect(value('acrobatismo')).toBe(0);
    expect(calc({ nivel: 20, for: 7, prof_atletismo: 'lendario' }).value('atletismo')).toBe(
      7 + 8 + 20,
    );
  });

  it('salvaguardas, Percepção e CD de classe começam treinadas', () => {
    const { value } = calc({ nivel: 1, con: 2, sab: 1, des: 3, atributo_chave: 'des' });
    expect(value('fortitude')).toBe(2 + 3);
    expect(value('reflexos')).toBe(3 + 3);
    expect(value('percepcao')).toBe(1 + 3);
    expect(value('cd_classe')).toBe(10 + 3 + 3);
  });

  it('CA: limite de Destreza, armadura e escudo erguido', () => {
    expect(calc({ nivel: 1, des: 3 }).value('ca')).toBe(10 + 3 + 3);
    expect(calc({ nivel: 1, des: 3, limite_des: 1, bonus_armadura: 4 }).value('ca')).toBe(
      10 + 1 + 3 + 4,
    );
    expect(calc({ nivel: 1, des: 0, escudo_erguido: true, escudo_ca: 2 }).value('ca')).toBe(
      10 + 0 + 3 + 2,
    );
  });

  it('PV: ancestralidade + (classe + Constituição) × nível', () => {
    const { max } = calc({ nivel: 3, con: 2, pv_ancestralidade: 8, pv_classe: 10 });
    expect(max('pv')).toBe(8 + (10 + 2) * 3);
    expect(calc({ ferido: 1 }).max('moribundo')).toBe(3);
  });

  it('magia, efeitos e volume', () => {
    const item = (id: string, values: Record<string, unknown>) => ({ id, values });
    const { value } = calc({
      nivel: 3,
      sab: 4,
      atributo_magia: 'sab',
      prof_magia: 'treinado',
      efeitos: [
        item('e1', { nome: 'Amedrontado 1', alvo: 'pericias', valor: -1, ativo: true }),
        item('e2', { nome: 'Amedrontado 1', alvo: 'cd', valor: -1, ativo: true }),
      ],
      equipamento: [
        item('a', { nome: 'Armadura', qtd: 1, volume: 2, investido: false }),
        item('b', { nome: 'Rações', qtd: 5, volume: 0.1, investido: false }),
        item('c', { nome: 'Anel', qtd: 1, volume: 0, investido: true }),
      ],
    });
    expect(value('mod_magia')).toBe(4);
    expect(value('ataque_magia')).toBe(4 + 2 + 3);
    expect(value('cd_magia')).toBe(10 + 4 + 5 - 1);
    expect(value('medicina')).toBe(4 - 1);
    expect(value('volume_total')).toBe(2);
    expect(value('investidos')).toBe(1);
  });
});
