import { describe, expect, it } from 'vitest';
import { clone, miniTemplate } from '../testing/fixtures';
import { compileTemplate } from './compile';
import { SystemTemplateSchema, type FieldDef, type SystemTemplate } from './schema';

/** Copia o template de teste aplicando uma alteração. */
function variant(change: (template: SystemTemplate) => void): SystemTemplate {
  const template = clone(miniTemplate());
  change(template);
  return template;
}

const field = (template: SystemTemplate, id: string) =>
  template.fields.find((f) => f.id === id) as FieldDef;

const codesOf = (template: SystemTemplate) => {
  const result = compileTemplate(template);
  return result.ok ? [] : result.error.map((issue) => issue.code);
};

describe('SystemTemplateSchema', () => {
  it('aceita o template de teste', () => {
    expect(SystemTemplateSchema.safeParse(miniTemplate()).success).toBe(true);
  });

  it.each([
    ['apelido com maiúscula', (t: SystemTemplate) => (field(t, 'f_for').key = 'For')],
    ['apelido começando com número', (t: SystemTemplate) => (field(t, 'f_for').key = '1for')],
    ['ID com espaço', (t: SystemTemplate) => (field(t, 'f_for').id = 'f for')],
    ['ID reservado (constructor)', (t: SystemTemplate) => (field(t, 'f_for').id = 'constructor')],
    ['ID reservado (__proto__)', (t: SystemTemplate) => (field(t, 'f_for').id = '__proto__')],
    ['rótulo vazio', (t: SystemTemplate) => (field(t, 'f_for').label = '   ')],
    ['versão fora do padrão', (t: SystemTemplate) => (t.version = '1.0')],
    [
      'tipo de campo desconhecido',
      (t: SystemTemplate) => ((field(t, 'f_for') as { type: string }).type = 'cor'),
    ],
    ['template sem campos', (t: SystemTemplate) => (t.fields = [])],
    [
      'número infinito',
      (t: SystemTemplate) => ((field(t, 'f_for') as { default: number }).default = Infinity),
    ],
    [
      'lista dentro de lista',
      (t: SystemTemplate) => {
        const list = field(t, 'f_inventario') as { itemFields: unknown[] };
        list.itemFields.push({ id: 'x', key: 'x', label: 'X', type: 'list', itemFields: [] });
      },
    ],
  ])('rejeita %s', (_, change) => {
    expect(SystemTemplateSchema.safeParse(variant(change)).success).toBe(false);
  });
});

describe('compileTemplate', () => {
  it('compila o template de teste', () => {
    expect(compileTemplate(miniTemplate()).ok).toBe(true);
  });

  it('ordena as fórmulas por dependência, não pela ordem de declaração', () => {
    const result = compileTemplate(miniTemplate());
    if (!result.ok) throw new Error('falhou');
    const order = result.value.formulas.map((f) => `${f.fieldId}:${f.target}`);
    const before = (a: string, b: string) =>
      expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    before('f_for_mod:value', 'f_atletismo:value');
    before('f_bonus_prof:value', 'f_atletismo:value');
    before('f_con_mod:value', 'f_hp:max');
    before('f_hp:max', 'f_hp_pct:value');
  });

  it.each<[string, (t: SystemTemplate) => void]>([
    ['id-duplicado', (t) => (field(t, 'f_des').id = 'f_for')],
    ['key-duplicada', (t) => (field(t, 'f_des').key = 'for')],
    [
      'key-duplicada',
      (t) => {
        const list = field(t, 'f_inventario') as Extract<FieldDef, { type: 'list' }>;
        (list.itemFields[1] as { key: string }).key = 'nome';
      },
    ],
    [
      'intervalo-invalido',
      (t) => Object.assign(field(t, 'f_nivel'), { min: 10, max: 5, default: 7 }),
    ],
    ['padrao-fora-do-intervalo', (t) => Object.assign(field(t, 'f_nivel'), { default: 30 })],
    ['padrao-nao-inteiro', (t) => Object.assign(field(t, 'f_nivel'), { default: 1.5 })],
    [
      'opcao-duplicada',
      (t) => {
        const select = field(t, 'f_classe') as Extract<FieldDef, { type: 'select' }>;
        select.options.push({ value: 'mago', label: 'Mago 2' });
      },
    ],
    ['padrao-invalido', (t) => Object.assign(field(t, 'f_classe'), { default: 'bardo' })],
    ['padrao-invalido', (t) => Object.assign(field(t, 'f_classe'), { default: ['mago'] })],
    ['padrao-invalido', (t) => Object.assign(field(t, 'f_idiomas'), { default: 'comum' })],
    ['formula-invalida', (t) => Object.assign(field(t, 'f_ca'), { formula: '10 + ' })],
    [
      'referencia-desconhecida',
      (t) => Object.assign(field(t, 'f_ca'), { formula: '10 + @sab_mod' }),
    ],
    ['referencia-nao-numerica', (t) => Object.assign(field(t, 'f_ca'), { formula: '@nome + 1' })],
    ['referencia-nao-numerica', (t) => Object.assign(field(t, 'f_ca'), { formula: '@inventario' })],
    ['propriedade-invalida', (t) => Object.assign(field(t, 'f_ca'), { formula: '@for.max' })],
    [
      'dependencia-circular',
      (t) => Object.assign(field(t, 'f_for_mod'), { formula: '@atletismo' }),
    ],
    ['dependencia-circular', (t) => Object.assign(field(t, 'f_ca'), { formula: '@ca + 1' })],
    ['dependencia-circular', (t) => Object.assign(field(t, 'f_hp'), { max: '@hp_pct' })],
    ['campo-inexistente', (t) => t.layouts.full.push({ kind: 'field', fieldId: 'f_fantasma' })],
    ['campo-repetido', (t) => t.layouts.full.push({ kind: 'field', fieldId: 'f_hp' })],
    ['campo-inexistente', (t) => (t.layouts.gmSummary = ['f_fantasma'])],
    [
      'layout-aninhado-demais',
      (t) => {
        let node: SystemTemplate['layouts']['full'][number] = { kind: 'field', fieldId: 'f_ca' };
        for (let i = 0; i < 10; i++)
          node = { kind: 'section', title: 'S', columns: 1, children: [node] };
        t.layouts.full = [node];
      },
    ],
  ])('detecta %s', (code, change) => {
    expect(codesOf(variant(change))).toContain(code);
  });

  it('mostra o caminho completo de uma dependência circular', () => {
    const result = compileTemplate(
      variant((t) => Object.assign(field(t, 'f_for_mod'), { formula: '@atletismo' })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.message).toBe(
        'Dependência circular: @for_mod → @atletismo → @for_mod',
      );
    }
  });

  it('aponta o caminho do campo com problema', () => {
    const result = compileTemplate(
      variant((t) => Object.assign(field(t, 'f_ca'), { formula: '10 + @sab_mod' })),
    );
    expect(result).toEqual({
      ok: false,
      error: [
        {
          code: 'referencia-desconhecida',
          path: ['fields', 14, 'formula'],
          message: 'Campo inexistente: @sab_mod',
        },
      ],
    });
  });

  it('referências a recurso sem fórmula de máximo não criam dependência', () => {
    const template = variant((t) => {
      t.fields.push({
        id: 'f_x',
        key: 'x',
        label: 'X',
        type: 'computed',
        formula: '@inspiracao.max',
      });
    });
    expect(compileTemplate(template).ok).toBe(true);
  });
});
