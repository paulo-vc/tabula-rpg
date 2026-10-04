import { compileTemplate, type CompiledTemplate } from '../template/compile';
import type { SystemTemplate } from '../template/schema';

/**
 * Template pequeno inspirado em D&D 5e, cobrindo todos os tipos de campo.
 * Usado apenas em testes.
 */
export function miniTemplate(): SystemTemplate {
  return {
    id: 'mini-5e',
    version: '1.0.0',
    name: 'Mini 5e',
    license: 'CC-BY-4.0',
    language: 'pt-BR',
    source: 'local',
    fields: [
      { id: 'f_nome', key: 'nome', label: 'Nome', type: 'text' },
      { id: 'f_historia', key: 'historia', label: 'História', type: 'longtext' },
      {
        id: 'f_classe',
        key: 'classe',
        label: 'Classe',
        type: 'select',
        options: [
          { value: 'guerreiro', label: 'Guerreiro' },
          { value: 'mago', label: 'Mago' },
        ],
      },
      {
        id: 'f_idiomas',
        key: 'idiomas',
        label: 'Idiomas',
        type: 'select',
        multiple: true,
        options: [
          { value: 'comum', label: 'Comum' },
          { value: 'elfico', label: 'Élfico' },
        ],
        default: ['comum'],
      },
      {
        id: 'f_nivel',
        key: 'nivel',
        label: 'Nível',
        type: 'number',
        default: 1,
        min: 1,
        max: 20,
        integer: true,
      },
      { id: 'f_for', key: 'for', label: 'Força', type: 'number', default: 10, integer: true },
      { id: 'f_des', key: 'des', label: 'Destreza', type: 'number', default: 10, integer: true },
      {
        id: 'f_con',
        key: 'con',
        label: 'Constituição',
        type: 'number',
        default: 10,
        integer: true,
      },
      {
        id: 'f_for_mod',
        key: 'for_mod',
        label: 'Mod. Força',
        type: 'computed',
        formula: 'floor((@for - 10) / 2)',
      },
      {
        id: 'f_des_mod',
        key: 'des_mod',
        label: 'Mod. Destreza',
        type: 'computed',
        formula: 'floor((@des - 10) / 2)',
      },
      {
        id: 'f_con_mod',
        key: 'con_mod',
        label: 'Mod. Constituição',
        type: 'computed',
        formula: 'floor((@con - 10) / 2)',
      },
      // Declarado antes das fórmulas de que depende: a ordem de cálculo não depende da ordem dos campos.
      {
        id: 'f_atletismo',
        key: 'atletismo',
        label: 'Atletismo',
        type: 'computed',
        formula: '@for_mod + if(@prof_atletismo, @bonus_prof, 0)',
      },
      {
        id: 'f_bonus_prof',
        key: 'bonus_prof',
        label: 'Bônus de proficiência',
        type: 'computed',
        formula: 'ceil(@nivel / 4) + 1',
      },
      {
        id: 'f_prof_atletismo',
        key: 'prof_atletismo',
        label: 'Proficiente em Atletismo',
        type: 'boolean',
      },
      { id: 'f_ca', key: 'ca', label: 'CA', type: 'computed', formula: '10 + @des_mod' },
      {
        id: 'f_hp',
        key: 'hp',
        label: 'Pontos de Vida',
        type: 'resource',
        max: '@nivel * (6 + @con_mod) + 4',
      },
      {
        id: 'f_hp_pct',
        key: 'hp_pct',
        label: 'HP %',
        type: 'computed',
        formula: 'round(@hp / @hp.max * 100)',
      },
      { id: 'f_inspiracao', key: 'inspiracao', label: 'Inspiração', type: 'resource', default: 1 },
      { id: 'f_ataque', key: 'ataque', label: 'Ataque', type: 'dice', default: '1d8' },
      {
        id: 'f_inventario',
        key: 'inventario',
        label: 'Inventário',
        type: 'list',
        maxItems: 50,
        itemFields: [
          { id: 'i_nome', key: 'nome', label: 'Item', type: 'text' },
          { id: 'i_qtd', key: 'qtd', label: 'Qtd.', type: 'number', default: 1, integer: true },
          { id: 'i_equipado', key: 'equipado', label: 'Equipado', type: 'boolean' },
        ],
      },
    ],
    layouts: {
      full: [
        {
          kind: 'section',
          title: 'Personagem',
          columns: 3,
          children: [
            { kind: 'field', fieldId: 'f_nome', span: 2 },
            { kind: 'field', fieldId: 'f_classe' },
            { kind: 'field', fieldId: 'f_nivel' },
          ],
        },
        {
          kind: 'section',
          title: 'Atributos',
          columns: 3,
          children: [
            { kind: 'field', fieldId: 'f_for' },
            { kind: 'field', fieldId: 'f_des' },
            { kind: 'field', fieldId: 'f_con' },
          ],
        },
        { kind: 'field', fieldId: 'f_hp' },
        { kind: 'field', fieldId: 'f_inventario' },
      ],
      gmSummary: ['f_hp', 'f_ca'],
    },
  };
}

export function compiledMiniTemplate(template: SystemTemplate = miniTemplate()): CompiledTemplate {
  const compiled = compileTemplate(template);
  if (!compiled.ok) {
    throw new Error(`fixture inválida: ${compiled.error.map((i) => i.message).join('; ')}`);
  }
  return compiled.value;
}

/** Cópia profunda para testes (o domínio não depende das APIs do DOM/Node, como `structuredClone`). */
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
