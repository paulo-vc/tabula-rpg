import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clone, compiledMiniTemplate, miniTemplate } from '../testing/fixtures';
import type { FieldDef, SystemTemplate } from '../template/schema';
import { computeDerived } from './compute';
import { checkCompatibility, migrateSheet } from './migrate';
import { createSheet, validateSheetValues } from './operations';
import { CharacterSheetSchema, type CharacterSheet, type SheetValues } from './schema';

const NOW = 1_700_000_000_000;
const newSheet = (compiled = compiledMiniTemplate()) =>
  createSheet(compiled, { id: 's1', name: 'Thorin', ownerId: 'u1', now: NOW });

const withValues = (sheet: CharacterSheet, values: SheetValues): CharacterSheet => ({
  ...sheet,
  values: { ...sheet.values, ...values },
});

/** Versão do template de teste com alterações. */
function templateVariant(version: string, change: (t: SystemTemplate) => void) {
  const template = clone(miniTemplate());
  template.version = version;
  change(template);
  return template;
}

describe('createSheet', () => {
  it('preenche os valores padrão de cada tipo de campo', () => {
    const sheet = newSheet();
    expect(sheet.values).toMatchObject({
      f_nome: '',
      f_classe: '',
      f_idiomas: ['comum'],
      f_nivel: 1,
      f_for: 10,
      f_prof_atletismo: false,
      f_inspiracao: { current: 1, max: 1 },
      f_ataque: '1d8',
      f_inventario: [],
    });
  });

  it('não armazena campos calculados', () => {
    const sheet = newSheet();
    expect(sheet.values).not.toHaveProperty('f_for_mod');
    expect(sheet.values).not.toHaveProperty('f_ca');
  });

  it('começa recursos com máximo calculado cheios', () => {
    // nível 1 × (6 + mod. CON 0) + 4 = 10
    expect(newSheet().values.f_hp).toEqual({ current: 10 });
  });

  it('gera uma ficha válida pelo schema e pelo template', () => {
    const compiled = compiledMiniTemplate();
    const sheet = newSheet(compiled);
    expect(CharacterSheetSchema.safeParse(sheet).success).toBe(true);
    expect(validateSheetValues(compiled, sheet)).toEqual([]);
    expect(sheet.templateRef).toEqual({ id: 'mini-5e', version: '1.0.0', source: 'local' });
  });
});

describe('computeDerived', () => {
  const compiled = compiledMiniTemplate();

  it('calcula campos e máximos de recursos', () => {
    const sheet = withValues(newSheet(), {
      f_nivel: 5,
      f_for: 16,
      f_des: 14,
      f_con: 14,
      f_prof_atletismo: true,
      f_hp: { current: 30 },
    });
    const { computed, resourceMax } = computeDerived(compiled, sheet.values);
    const value = (id: string) => (computed[id]?.ok ? computed[id].value : computed[id]);
    expect(value('f_for_mod')).toBe(3);
    expect(value('f_bonus_prof')).toBe(3);
    expect(value('f_atletismo')).toBe(6);
    expect(value('f_ca')).toBe(12);
    expect(resourceMax.f_hp).toEqual({ ok: true, value: 44 }); // 5 × (6 + 2) + 4
    expect(value('f_hp_pct')).toBe(68); // 30 / 44
  });

  it('usa o padrão quando o valor está ausente', () => {
    const { computed } = computeDerived(compiled, {});
    expect(computed.f_for_mod).toEqual({ ok: true, value: 0 });
  });

  it('isola erros: dependentes falham, independentes seguem', () => {
    const template = clone(miniTemplate());
    const ca = template.fields.find((f) => f.id === 'f_ca') as Extract<
      FieldDef,
      { type: 'computed' }
    >;
    ca.formula = '10 / (@des - 10)';
    template.fields.push({
      id: 'f_ca2',
      key: 'ca2',
      label: 'CA2',
      type: 'computed',
      formula: '@ca + 1',
    });
    const result = computeDerived(compiledMiniTemplate(template), newSheet().values);
    expect(result.computed.f_ca).toMatchObject({ ok: false, error: { code: 'divisao-por-zero' } });
    expect(result.computed.f_ca2).toMatchObject({
      ok: false,
      error: { code: 'referencia-indefinida' },
    });
    expect(result.computed.f_for_mod).toEqual({ ok: true, value: 0 });
  });

  it('ignora valores com tipo errado em vez de lançar exceção', () => {
    const { computed } = computeDerived(compiled, { f_for: 'dezesseis' as unknown as number });
    expect(computed.f_for_mod).toMatchObject({
      ok: false,
      error: { code: 'referencia-indefinida' },
    });
  });
});

describe('validateSheetValues', () => {
  const compiled = compiledMiniTemplate();
  const codes = (values: SheetValues) =>
    validateSheetValues(compiled, withValues(newSheet(), values)).map((i) => [i.code, i.path[1]]);

  it.each<[string, SheetValues]>([
    ['número como texto', { f_for: '16' }],
    ['inteiro com decimal', { f_nivel: 2.5 }],
    ['opção inexistente', { f_classe: 'bardo' }],
    ['seleção múltipla como texto', { f_idiomas: 'comum' }],
    ['opção múltipla inexistente', { f_idiomas: ['comum', 'orc'] }],
    ['recurso sem atual', { f_hp: { max: 3 } as never }],
    ['recurso sem máximo (sem fórmula)', { f_inspiracao: { current: 1 } }],
    ['texto como booleano', { f_prof_atletismo: 'sim' }],
    ['item de lista com tipo errado', { f_inventario: [{ id: 'a', values: { i_qtd: 'dois' } }] }],
    [
      'itens com ID repetido',
      {
        f_inventario: [
          { id: 'a', values: {} },
          { id: 'a', values: {} },
        ],
      },
    ],
    [
      'lista acima do limite',
      { f_inventario: Array.from({ length: 51 }, (_, i) => ({ id: `i${i}`, values: {} })) },
    ],
    ['valor para campo calculado', { f_ca: 15 }],
  ])('rejeita %s', (_, values) => {
    const [fieldId] = Object.keys(values);
    expect(codes(values)).toEqual([['valor-invalido', fieldId]]);
  });

  it('aceita valores acima do máximo sugerido (regras da casa)', () => {
    expect(codes({ f_nivel: 25 })).toEqual([]);
  });

  it('rejeita campo desconhecido e ficha de outro sistema', () => {
    const sheet = withValues(newSheet(), { f_fantasma: 1 });
    sheet.templateRef = { ...sheet.templateRef, id: 'outro' };
    expect(validateSheetValues(compiled, sheet).map((i) => i.code)).toEqual([
      'template-diferente',
      'campo-desconhecido',
    ]);
  });
});

describe('checkCompatibility', () => {
  const ref = newSheet().templateRef; // mini-5e 1.0.0
  const at = (version: string, id = 'mini-5e') => ({ ...miniTemplate(), id, version });

  it.each([
    ['1.0.0', { kind: 'mesma-versao' }],
    ['1.2.0', { kind: 'atualizacao', breaking: false }],
    ['1.0.10', { kind: 'atualizacao', breaking: false }],
    ['2.0.0', { kind: 'atualizacao', breaking: true }],
    ['0.9.0', { kind: 'versao-anterior' }],
  ])('versão %s', (version, expected) => {
    expect(checkCompatibility(ref, at(version))).toEqual(expected);
  });

  it('compara numericamente, não como texto', () => {
    expect(checkCompatibility({ ...ref, version: '1.9.0' }, at('1.10.0'))).toEqual({
      kind: 'atualizacao',
      breaking: false,
    });
  });

  it('detecta outro sistema', () => {
    expect(checkCompatibility(ref, at('1.0.0', 'coc-7e'))).toEqual({ kind: 'outro-sistema' });
  });
});

describe('migrateSheet', () => {
  const original = withValues(newSheet(), { f_for: 18, f_nome: 'Thorin' });

  it('preserva valores, adiciona campos novos e guarda os removidos', () => {
    const target = compiledMiniTemplate(
      templateVariant('1.1.0', (t) => {
        t.fields = t.fields.filter(
          (f) => f.id !== 'f_for' && f.id !== 'f_for_mod' && f.id !== 'f_atletismo',
        );
        t.fields.push({ id: 'f_sab', key: 'sab', label: 'Sabedoria', type: 'number', default: 8 });
        t.layouts.full = [];
      }),
    );
    const { sheet, report } = migrateSheet(original, target, NOW + 1);

    expect(report).toEqual({ added: ['f_sab'], orphaned: ['f_for'], restored: [] });
    expect(sheet.values.f_nome).toBe('Thorin');
    expect(sheet.values.f_sab).toBe(8);
    expect(sheet.values).not.toHaveProperty('f_for');
    expect(sheet.orphaned).toEqual({ f_for: 18 });
    expect(sheet.templateRef.version).toBe('1.1.0');
    expect(sheet.updatedAt).toBe(NOW + 1);
    expect(validateSheetValues(target, sheet)).toEqual([]);
  });

  it('guarda valores cujo tipo mudou e usa o padrão do novo tipo', () => {
    const target = compiledMiniTemplate(
      templateVariant('2.0.0', (t) => {
        const index = t.fields.findIndex((f) => f.id === 'f_nome');
        t.fields[index] = { id: 'f_nome', key: 'nome', label: 'Nome', type: 'number' };
      }),
    );
    const { sheet, report } = migrateSheet(original, target, NOW);
    expect(report.orphaned).toEqual(['f_nome']);
    expect(sheet.values.f_nome).toBe(0);
    expect(sheet.orphaned).toEqual({ f_nome: 'Thorin' });
  });

  it('restaura o valor guardado quando o campo volta', () => {
    const without = compiledMiniTemplate(
      templateVariant('1.1.0', (t) => {
        t.fields = t.fields.filter((f) => !['f_for', 'f_for_mod', 'f_atletismo'].includes(f.id));
        t.layouts.full = [];
      }),
    );
    const back = compiledMiniTemplate(templateVariant('1.2.0', () => {}));
    const step1 = migrateSheet(original, without, NOW).sheet;
    const { sheet, report } = migrateSheet(step1, back, NOW);
    expect(report.restored).toEqual(['f_for']);
    expect(sheet.values.f_for).toBe(18);
    expect(sheet).not.toHaveProperty('orphaned');
  });

  it('propriedade: migrar para a mesma estrutura preserva os valores e é idempotente', () => {
    const compiled = compiledMiniTemplate();
    const valuesArb = fc.record(
      {
        f_for: fc.integer({ min: 1, max: 30 }),
        f_nome: fc.string({ maxLength: 20 }),
        f_classe: fc.constantFrom('', 'guerreiro', 'mago'),
        f_prof_atletismo: fc.boolean(),
        f_hp: fc.record({ current: fc.integer({ min: -10, max: 100 }) }),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(valuesArb, (values) => {
        const sheet = withValues(newSheet(compiled), values);
        const once = migrateSheet(sheet, compiled, NOW).sheet;
        const twice = migrateSheet(once, compiled, NOW).sheet;
        expect(once.values).toEqual(sheet.values);
        expect(twice).toEqual(once);
      }),
    );
  });
});
