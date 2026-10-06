import { describe, expect, it } from 'vitest';
import { computeDerived } from '../sheet/compute';
import type { SheetValues } from '../sheet/schema';
import { compileTemplate } from './compile';
import type { FieldDef, SystemTemplate } from './schema';

/** Template com listas, seleções numéricas e efeitos temporários. */
const BASE_FIELDS: FieldDef[] = [
  { id: 'base_ca', key: 'base_ca', label: 'CA base', type: 'number', default: 10 },
  { id: 'for', key: 'for', label: 'Força', type: 'number', default: 10 },
  {
    id: 'tamanho',
    key: 'tamanho',
    label: 'Tamanho',
    type: 'select',
    options: [
      { value: 'pequeno', label: 'Pequeno', number: 1 },
      { value: 'medio', label: 'Médio', number: 0 },
      { value: 'grande', label: 'Grande', number: -1 },
    ],
    default: 'medio',
  },
  {
    id: 'condicoes',
    key: 'condicoes',
    label: 'Condições',
    type: 'select',
    multiple: true,
    options: [
      { value: 'envenenado', label: 'Envenenado' },
      { value: 'caido', label: 'Caído' },
    ],
  },
  { id: 'nome', key: 'nome', label: 'Nome', type: 'text' },
  {
    id: 'equipamento',
    key: 'equipamento',
    label: 'Equipamento',
    type: 'list',
    itemFields: [
      { id: 'nome', key: 'nome', label: 'Item', type: 'text' },
      { id: 'qtd', key: 'qtd', label: 'Qtd.', type: 'number', default: 1 },
      { id: 'peso', key: 'peso', label: 'Peso', type: 'number', default: 0 },
      { id: 'bonus_ca', key: 'bonus_ca', label: 'Bônus CA', type: 'number', default: 0 },
      { id: 'equipado', key: 'equipado', label: 'Equipado', type: 'boolean' },
    ],
  },
  {
    id: 'efeitos',
    key: 'efeitos',
    label: 'Efeitos',
    type: 'list',
    itemFields: [
      { id: 'nome', key: 'nome', label: 'Efeito', type: 'text' },
      {
        id: 'alvo',
        key: 'alvo',
        label: 'Alvo',
        type: 'select',
        options: [
          { value: 'ca', label: 'CA' },
          { value: 'ataque', label: 'Ataque' },
        ],
      },
      { id: 'valor', key: 'valor', label: 'Valor', type: 'number', default: 0 },
      { id: 'ativo', key: 'ativo', label: 'Ativo', type: 'boolean', default: true },
    ],
  },
];

function templateWith(formulas: Record<string, string>): SystemTemplate {
  return {
    id: 'avancado',
    version: '1.0.0',
    name: 'Avançado',
    source: 'local',
    fields: [
      ...BASE_FIELDS,
      ...Object.entries(formulas).map(([key, formula]): FieldDef => ({
        id: key,
        key,
        label: key,
        type: 'computed',
        formula,
      })),
    ],
    layouts: { full: [] },
  };
}

const problemsOf = (formula: string) => {
  const result = compileTemplate(templateWith({ x: formula }));
  return result.ok ? [] : result.error.map((issue) => issue.code);
};

function compute(formulas: Record<string, string>, values: SheetValues) {
  const compiled = compileTemplate(templateWith(formulas));
  if (!compiled.ok) throw new Error(compiled.error.map((i) => i.message).join('; '));
  const { computed } = computeDerived(compiled.value, values);
  return Object.fromEntries(
    Object.entries(computed).map(([id, result]) => [
      id,
      result.ok ? result.value : result.error.code,
    ]),
  );
}

const item = (id: string, values: Record<string, unknown>) => ({ id, values }) as never;

describe('fórmulas avançadas: validação ao compilar o template', () => {
  it.each([
    ['sum(@equipamento.peso * @equipamento.qtd)', []],
    ['count(@equipamento)', []],
    ['count(@equipamento.equipado)', []],
    ['@base_ca + sum(@equipamento.bonus_ca * @equipamento.equipado)', []],
    ['is(@condicoes, "envenenado")', []],
    ['@tamanho + 1', []],
    ['sum(@efeitos.valor * @efeitos.ativo * is(@efeitos.alvo, "ca"))', []],
    ['sum(@equipamento.peso) + sum(@efeitos.valor)', []],
    ['@equipamento', ['lista-fora-de-agregacao']],
    ['@equipamento.peso + 1', ['lista-fora-de-agregacao']],
    ['sum(@equipamento.peso * @efeitos.valor)', ['listas-diferentes']],
    ['sum(sum(@equipamento.peso))', ['agregacao-aninhada']],
    ['sum(@for)', ['agregacao-sem-lista']],
    ['sum(@equipamento.preco)', ['propriedade-invalida']],
    ['sum(@equipamento.nome)', ['referencia-nao-numerica']],
    ['is(@for, "x")', ['is-invalido']],
    ['is(@condicoes, @for)', ['is-invalido']],
    ['is(@condicoes, "envenenada")', ['opcao-inexistente']],
    ['is(@efeitos.alvo, "ca")', ['lista-fora-de-agregacao']],
    ['@for + "3"', ['texto-fora-de-is']],
    ['@tamanho.max', ['propriedade-invalida']],
    ['@nome', ['referencia-nao-numerica']],
  ])('%s → %j', (formula, expected) => {
    expect(problemsOf(formula)).toEqual(expected);
  });

  it('a mensagem de opção inexistente lista as opções válidas', () => {
    const result = compileTemplate(templateWith({ x: 'is(@condicoes, "envenenada")' }));
    expect(result.ok || result.error[0]?.message).toBe(
      '@condicoes não tem a opção "envenenada" (opções: "envenenado", "caido")',
    );
  });
});

describe('fórmulas avançadas: cálculo', () => {
  const equipment = [
    item('a', { nome: 'Escudo', bonus_ca: 2, peso: 3, equipado: true }),
    item('b', { nome: 'Escudo reserva', bonus_ca: 2, peso: 3, equipado: false }),
    item('c', { nome: 'Flechas', qtd: 20, peso: 0.05 }),
  ];

  it('soma só os itens que a expressão seleciona', () => {
    const result = compute(
      {
        ca: '@base_ca + sum(@equipamento.bonus_ca * @equipamento.equipado)',
        peso: 'sum(@equipamento.peso * @equipamento.qtd)',
        itens: 'count(@equipamento)',
        equipados: 'count(@equipamento.equipado)',
      },
      { equipamento: equipment },
    );
    expect(result).toEqual({ ca: 12, peso: 7, itens: 3, equipados: 1 });
  });

  it('lista vazia soma e conta zero', () => {
    expect(compute({ s: 'sum(@equipamento.peso)', c: 'count(@equipamento)' }, {})).toEqual({
      s: 0,
      c: 0,
    });
  });

  it('seleções valem o número da opção (soma, se múltipla) e is() testa a opção', () => {
    expect(
      compute(
        { t: '@tamanho', v: 'is(@condicoes, "envenenado")', c: 'is(@condicoes, "caido")' },
        {
          tamanho: 'pequeno',
          condicoes: ['envenenado'],
        },
      ),
    ).toEqual({ t: 1, v: 1, c: 0 });
    expect(compute({ t: '@tamanho' }, { tamanho: '' })).toEqual({ t: 0 });
  });

  it('efeitos temporários: só os ativos e só os do alvo', () => {
    const effects = [
      item('e1', { nome: 'Escudo da Fé', alvo: 'ca', valor: 2, ativo: true }),
      item('e2', { nome: 'Bênção', alvo: 'ataque', valor: 1, ativo: true }),
      item('e3', { nome: 'Armadura Arcana (acabou)', alvo: 'ca', valor: 3, ativo: false }),
    ];
    const result = compute(
      {
        ca: '@base_ca + sum(@efeitos.valor * @efeitos.ativo * is(@efeitos.alvo, "ca"))',
        ataque: 'sum(@efeitos.valor * @efeitos.ativo * is(@efeitos.alvo, "ataque"))',
      },
      { efeitos: effects },
    );
    expect(result).toEqual({ ca: 12, ataque: 1 });
  });

  it('agregações podem depender de outros campos calculados e alimentar outros', () => {
    const result = compute(
      {
        // Declarado antes do que usa: a ordem de cálculo resolve.
        sobrecarregado: '@carga > @capacidade',
        capacidade: '@for * 7.5',
        carga: 'sum(@equipamento.peso * @equipamento.qtd)',
      },
      { for: 1, equipamento: equipment },
    );
    expect(result).toEqual({ sobrecarregado: 0, capacidade: 7.5, carga: 7 });
  });

  it('erro em um item (divisão por zero) vira erro do campo, sem derrubar os outros', () => {
    const result = compute(
      { r: 'sum(10 / @equipamento.qtd)', ok: '@for' },
      { equipamento: [item('a', { qtd: 0 })] },
    );
    expect(result).toEqual({ r: 'divisao-por-zero', ok: 10 });
  });
});
