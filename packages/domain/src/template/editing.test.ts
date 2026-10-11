import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clone, miniTemplate } from '../testing/fixtures';
import { compileTemplate } from './compile';
import {
  addField,
  addSection,
  blankTemplate,
  bumpVersion,
  contentChanged,
  copyTemplate,
  createItemField,
  duplicateField,
  FIELD_TYPE_LABELS,
  fieldsReferencing,
  issuesByField,
  keyFromLabel,
  moveFieldToSection,
  moveNode,
  moveNodeTo,
  pathOfField,
  removeField,
  removeSection,
  renameReference,
  setFieldSecondary,
  setFieldSpan,
  setInGmSummary,
  templateIdFromName,
  uniqueName,
  updateField,
  updateSection,
  withType,
} from './editing';
import type { FieldDef, FieldType, LayoutNode, SystemTemplate } from './schema';

const blank = () => blankTemplate({ id: 'novo', name: 'Novo' });

const compiles = (template: SystemTemplate) => {
  const result = compileTemplate(template);
  if (!result.ok) throw new Error(result.error.map((i) => i.message).join('; '));
  return true;
};

/** Títulos e campos do layout, para comparar a estrutura de forma legível. */
const outline = (nodes: readonly LayoutNode[]): unknown[] =>
  nodes.map((node) =>
    node.kind === 'field' ? node.fieldId : { [node.title]: outline(node.children) },
  );

const field = (template: SystemTemplate, id: string) =>
  template.fields.find((f) => f.id === id) as FieldDef;

describe('nomes', () => {
  it.each([
    ['Força de Vontade', 'forca_de_vontade'],
    ['  PV máx. ', 'pv_max'],
    ['1º Ataque', 'ataque'],
    ['!!!', 'campo'],
    ['Classe de Armadura (CA)', 'classe_de_armadura_ca'],
    ['a'.repeat(60), 'a'.repeat(36)],
  ])('%j → %s', (label, key) => {
    expect(keyFromLabel(label)).toBe(key);
  });

  it('o apelido gerado é sempre válido em fórmulas', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (label) => {
        expect(keyFromLabel(label)).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
      }),
    );
  });

  it('evita nomes repetidos', () => {
    expect(uniqueName('for', new Set(['for', 'for_2']))).toBe('for_3');
    expect(templateIdFromName('Meu Sistema!', new Set(['meu-sistema']))).toBe('meu-sistema-2');
    expect(templateIdFromName('???', new Set())).toBe('sistema');
  });
});

describe('templates novos', () => {
  it('o template em branco e a cópia compilam', () => {
    expect(compiles(blank())).toBe(true);
    const copy = copyTemplate(
      { ...miniTemplate(), source: 'builtin', version: '3.2.1' },
      {
        id: 'meu-mini',
        name: 'Meu Mini',
      },
    );
    expect(copy).toMatchObject({
      id: 'meu-mini',
      name: 'Meu Mini',
      version: '1.0.0',
      source: 'local',
    });
    expect(compiles(copy)).toBe(true);
  });

  it('todo tipo de campo novo compila', () => {
    for (const type of Object.keys(FIELD_TYPE_LABELS) as FieldType[]) {
      const { template } = addField(blank(), type, FIELD_TYPE_LABELS[type], [0]);
      expect(compiles(template)).toBe(true);
    }
  });
});

describe('campos', () => {
  it('adiciona no fim da seção com apelido e ID únicos', () => {
    let template = blank();
    ({ template } = addField(template, 'number', 'Força', [0]));
    const added = addField(template, 'number', 'Força', [0]);
    expect(added.fieldId).toBe('forca_2');
    expect(field(added.template, 'forca_2')).toMatchObject({ key: 'forca_2', type: 'number' });
    expect(outline(added.template.layouts.full)).toEqual([
      { Personagem: ['nome', 'forca', 'forca_2'] },
    ]);
  });

  it('o ID não muda ao renomear; as fórmulas acompanham o apelido', () => {
    let template = blank();
    ({ template } = addField(template, 'number', 'For', [0]));
    ({ template } = addField(template, 'computed', 'Mod', [0]));
    template = updateField(template, {
      ...(field(template, 'mod') as FieldDef & { type: 'computed' }),
      formula: 'floor((@for - 10) / 2) + @for_bonus',
    });
    ({ template } = addField(template, 'resource', 'PV', [0]));
    template = updateField(template, {
      ...(field(template, 'pv') as FieldDef & { type: 'resource' }),
      max: '@for * 2',
    });

    template = updateField(template, { ...field(template, 'for'), key: 'forca' });
    expect(field(template, 'for').key).toBe('forca');
    expect(field(template, 'mod')).toMatchObject({
      formula: 'floor((@forca - 10) / 2) + @for_bonus',
    });
    expect(field(template, 'pv')).toMatchObject({ max: '@forca * 2' });
  });

  it.each([
    ['@a + @ab + @a_1 + @a', '@b + @ab + @a_1 + @b'],
    ['is(@a, "@a") + @a', 'is(@b, "@a") + @b'],
    ['"aspas \\" @a" + @a', '"aspas \\" @a" + @b'],
    ['sum(@a.x)', 'sum(@b.x)'],
  ])('renomeia %s', (formula, expected) => {
    expect(renameReference(formula, 'a', 'b')).toBe(expected);
  });

  it('trocar o tipo mantém nome, apelido e descrição', () => {
    const changed = withType(
      { id: 'x', key: 'x', label: 'X', description: 'd', visibility: 'gm' },
      'select',
    );
    expect(changed).toMatchObject({
      id: 'x',
      key: 'x',
      label: 'X',
      description: 'd',
      visibility: 'gm',
    });
    expect(changed.type).toBe('select');
  });

  it('itens de lista ganham apelido único na lista', () => {
    const item = createItemField('number', 'Nome', [
      { id: 'nome', key: 'nome', label: 'Nome', type: 'text' },
    ]);
    expect(item).toMatchObject({ id: 'nome_2', key: 'nome_2', type: 'number' });
  });

  it('remove o campo da lista, da ficha e do resumo do Mestre', () => {
    let template = clone(miniTemplate());
    template = setInGmSummary(template, 'f_for', true);
    expect(template.layouts.gmSummary).toContain('f_for');
    expect(pathOfField(template.layouts.full, 'f_for')).not.toBeNull();

    template = removeField(template, 'f_for');
    expect(template.fields.some((f) => f.id === 'f_for')).toBe(false);
    expect(pathOfField(template.layouts.full, 'f_for')).toBeNull();
    expect(template.layouts.gmSummary).not.toContain('f_for');
  });

  it('lista quem usa um apelido, para avisar antes de excluir', () => {
    const users = fieldsReferencing(miniTemplate(), 'for_mod').map((f) => f.id);
    expect(users).toContain('f_atletismo');
    expect(users).not.toContain('f_for_mod');
  });

  it('o resumo do Mestre não passa do limite nem repete campos', () => {
    let template = blank();
    for (let i = 0; i < 15; i++) {
      ({ template } = addField(template, 'number', `N${i}`, [0]));
      template = setInGmSummary(template, `n${i}`, true);
    }
    template = setInGmSummary(template, 'n14', true);
    expect(template.layouts.gmSummary).toHaveLength(12);
    expect(new Set(template.layouts.gmSummary).size).toBe(12);
    expect(setInGmSummary(template, 'n14', false).layouts.gmSummary).not.toContain('n14');
  });
});

describe('layout', () => {
  /** Duas seções: A [nome, x] e B [y]. */
  const twoSections = () => {
    let template = blank();
    template = updateSection(template, [0], { title: 'A' });
    ({ template } = addField(template, 'number', 'X', [0]));
    template = addSection(template, 'B');
    ({ template } = addField(template, 'number', 'Y', [1]));
    return template;
  };

  it('cria, renomeia e muda colunas de seções', () => {
    const template = updateSection(twoSections(), [1], { title: 'Combate', columns: 4 });
    expect(template.layouts.full[1]).toMatchObject({ title: 'Combate', columns: 4 });
    expect(outline(template.layouts.full)).toEqual([{ A: ['nome', 'x'] }, { Combate: ['y'] }]);
  });

  it('sobe e desce campos e seções, sem passar das pontas', () => {
    let template = twoSections();
    template = moveNode(template, [0, 1], -1);
    expect(outline(template.layouts.full)).toEqual([{ A: ['x', 'nome'] }, { B: ['y'] }]);
    expect(moveNode(template, [0, 0], -1)).toBe(template);
    template = moveNode(template, [1], -1);
    expect(outline(template.layouts.full)).toEqual([{ B: ['y'] }, { A: ['x', 'nome'] }]);
    expect(moveNode(template, [1], 1)).toBe(template);
  });

  it('leva um campo para outra seção (antes ou depois dela)', () => {
    let template = twoSections();
    template = moveFieldToSection(template, 'nome', [1]);
    expect(outline(template.layouts.full)).toEqual([{ A: ['x'] }, { B: ['y', 'nome'] }]);
    template = moveFieldToSection(template, 'y', [0]);
    expect(outline(template.layouts.full)).toEqual([{ A: ['x', 'y'] }, { B: ['nome'] }]);
    // Na mesma seção: vai para o fim.
    template = moveFieldToSection(template, 'x', [0]);
    expect(outline(template.layouts.full)).toEqual([{ A: ['y', 'x'] }, { B: ['nome'] }]);
  });

  it('posiciona um campo que estava fora da ficha', () => {
    const template = twoSections();
    template.fields.push({ id: 'solto', key: 'solto', label: 'Solto', type: 'text' });
    expect(outline(moveFieldToSection(template, 'solto', [1]).layouts.full)).toEqual([
      { A: ['nome', 'x'] },
      { B: ['y', 'solto'] },
    ]);
  });

  it('só remove seções vazias', () => {
    let template = addSection(twoSections(), 'Vazia');
    expect(removeSection(template, [1])).toBe(template);
    template = removeSection(template, [2]);
    expect(outline(template.layouts.full)).toEqual([{ A: ['nome', 'x'] }, { B: ['y'] }]);
  });

  it('largura do campo: fixa ou automática', () => {
    let template = setFieldSpan(twoSections(), 'x', 2);
    expect(template.layouts.full[0]).toMatchObject({ children: [{}, { fieldId: 'x', span: 2 }] });
    template = setFieldSpan(template, 'x', undefined);
    expect(template.layouts.full[0]).toMatchObject({ children: [{}, { fieldId: 'x' }] });
    expect('span' in ((template.layouts.full[0] as { children: object[] }).children[1] ?? {})).toBe(
      false,
    );
  });

  it('nenhuma operação de layout perde ou duplica campos', () => {
    const operation = fc.oneof(
      fc.tuple(
        fc.constant('mover' as const),
        fc.nat(5),
        fc.nat(5),
        fc.constantFrom(-1 as const, 1 as const),
      ),
      fc.tuple(fc.constant('secao' as const), fc.constantFrom('nome', 'x', 'y'), fc.nat(3)),
      fc.tuple(fc.constant('nova' as const)),
    );
    fc.assert(
      fc.property(fc.array(operation, { maxLength: 20 }), (operations) => {
        let template = twoSections();
        for (const op of operations) {
          if (op[0] === 'mover') template = moveNode(template, [op[1] % 3, op[2] % 3], op[3]);
          else if (op[0] === 'secao') template = moveFieldToSection(template, op[1], [op[2]]);
          else template = addSection(template, 'Nova');
        }
        const placed = outline(template.layouts.full).flatMap((s) =>
          Object.values(s as Record<string, string[]>).flat(),
        );
        expect(placed.sort()).toEqual(['nome', 'x', 'y']);
        expect(compiles(template)).toBe(true);
      }),
    );
  });
});

describe('versões e problemas', () => {
  it.each([
    ['1.2.3', 'patch', '1.2.4'],
    ['1.2.3', 'minor', '1.3.0'],
    ['1.2.3', 'major', '2.0.0'],
  ] as const)('%s + %s = %s', (version, bump, expected) => {
    expect(bumpVersion(version, bump)).toBe(expected);
  });

  it('mudança de versão ou origem não conta como mudança de conteúdo', () => {
    const a = blank();
    expect(contentChanged(a, { ...a, version: '9.0.0', source: 'community' })).toBe(false);
    expect(contentChanged(a, { ...a, name: 'Outro' })).toBe(true);
  });

  it('agrupa os problemas pelo campo', () => {
    let template = blank();
    ({ template } = addField(template, 'computed', 'Total', [0]));
    template = updateField(template, {
      ...(field(template, 'total') as FieldDef & { type: 'computed' }),
      formula: '@inexistente',
    });
    template = { ...template, layouts: { ...template.layouts, gmSummary: ['fantasma'] } };
    const result = compileTemplate(template);
    if (result.ok) throw new Error('deveria falhar');
    const { byField, general } = issuesByField(template, result.error);
    expect(byField.get('total')?.map((i) => i.code)).toEqual(['referencia-desconhecida']);
    expect(general.map((i) => i.code)).toEqual(['campo-inexistente']);
  });
});

describe('6b: colunas, duplicar e arrastar', () => {
  /** Lista "itens" com colunas peso e qtd, usada por uma fórmula. */
  const withList = () => {
    let template = blank();
    ({ template } = addField(template, 'list', 'Itens', [0]));
    const list = field(template, 'itens') as FieldDef & { type: 'list' };
    template = updateField(template, {
      ...list,
      itemFields: [
        ...list.itemFields,
        createItemField('number', 'Peso', list.itemFields),
        createItemField('number', 'Qtd', list.itemFields),
      ],
    });
    ({ template } = addField(template, 'computed', 'Carga', [0]));
    return updateField(template, {
      ...(field(template, 'carga') as FieldDef & { type: 'computed' }),
      formula: 'sum(@itens.peso * @itens.qtd) + count(@itens)',
    });
  };

  it('renomear uma coluna de lista reescreve as fórmulas', () => {
    let template = withList();
    const list = field(template, 'itens') as FieldDef & { type: 'list' };
    template = updateField(template, {
      ...list,
      itemFields: list.itemFields.map((item) =>
        item.key === 'peso' ? { ...item, key: 'kg' } : item,
      ),
    });
    expect(field(template, 'carga')).toMatchObject({
      formula: 'sum(@itens.kg * @itens.qtd) + count(@itens)',
    });
    expect(compiles(template)).toBe(true);
  });

  it('renomear a lista e uma coluna ao mesmo tempo', () => {
    let template = withList();
    const list = field(template, 'itens') as FieldDef & { type: 'list' };
    template = updateField(template, {
      ...list,
      key: 'mochila',
      itemFields: list.itemFields.map((item) =>
        item.key === 'qtd' ? { ...item, key: 'quantidade' } : item,
      ),
    });
    expect(field(template, 'carga')).toMatchObject({
      formula: 'sum(@mochila.peso * @mochila.quantidade) + count(@mochila)',
    });
    expect(compiles(template)).toBe(true);
  });

  it('referências com ponto não confundem prefixos', () => {
    expect(renameReference('@a.b + @a.bc + @ab.b', 'a.b', 'a.z')).toBe('@a.z + @a.bc + @ab.b');
  });

  it('duplica o campo logo abaixo, com apelido novo', () => {
    let template = withList();
    const result = duplicateField(template, 'itens');
    template = result.template;
    expect(result.fieldId).toBe('itens_2');
    expect(field(template, 'itens_2')).toMatchObject({ key: 'itens_2', label: 'Itens (cópia)' });
    expect(outline(template.layouts.full)).toEqual([
      { Personagem: ['nome', 'itens', 'itens_2', 'carga'] },
    ]);
    expect(compiles(template)).toBe(true);
    // A cópia é independente do original.
    (field(template, 'itens_2') as FieldDef & { type: 'list' }).itemFields.pop();
    expect((field(template, 'itens') as FieldDef & { type: 'list' }).itemFields).toHaveLength(3);
  });

  describe('moveNodeTo', () => {
    /** A [nome, x], B [y, z], e um campo solto "w" no fim. */
    const layout = () => {
      let template = blank();
      template = updateSection(template, [0], { title: 'A' });
      ({ template } = addField(template, 'number', 'X', [0]));
      template = addSection(template, 'B');
      ({ template } = addField(template, 'number', 'Y', [1]));
      ({ template } = addField(template, 'number', 'Z', [1]));
      ({ template } = addField(template, 'number', 'W', null));
      return template;
    };

    it.each<[string, number[], number[], number, unknown[]]>([
      ['desce na mesma seção', [0, 0], [0], 1, [{ A: ['x', 'nome'] }, { B: ['y', 'z'] }, 'w']],
      ['sobe na mesma seção', [1, 1], [1], 0, [{ A: ['nome', 'x'] }, { B: ['z', 'y'] }, 'w']],
      ['vai para outra seção', [0, 1], [1], 1, [{ A: ['nome'] }, { B: ['y', 'x', 'z'] }, 'w']],
      ['vem de outra seção', [1, 0], [0], 0, [{ A: ['y', 'nome', 'x'] }, { B: ['z'] }, 'w']],
      ['campo solto entra numa seção', [2], [1], 2, [{ A: ['nome', 'x'] }, { B: ['y', 'z', 'w'] }]],
      [
        'campo sai para o nível da ficha',
        [1, 0],
        [],
        0,
        ['y', { A: ['nome', 'x'] }, { B: ['z'] }, 'w'],
      ],
      ['troca a ordem das seções', [1], [], 0, [{ B: ['y', 'z'] }, { A: ['nome', 'x'] }, 'w']],
    ])('%s', (_, from, parent, index, expected) => {
      const template = moveNodeTo(layout(), from, parent, index);
      expect(outline(template.layouts.full)).toEqual(expected);
      expect(compiles(template)).toBe(true);
    });

    it('não põe uma seção dentro dela mesma nem dentro de um campo', () => {
      const template = layout();
      expect(moveNodeTo(template, [0], [0], 0)).toBe(template);
      expect(moveNodeTo(template, [1, 0], [2], 0)).toBe(template);
      expect(moveNodeTo(template, [9], [], 0)).toBe(template);
    });

    it('nenhuma sequência de arrastos perde ou duplica campos', () => {
      const path = fc.array(fc.nat(3), { minLength: 1, maxLength: 2 });
      fc.assert(
        fc.property(
          fc.array(fc.tuple(path, fc.array(fc.nat(3), { maxLength: 1 }), fc.nat(4)), {
            maxLength: 15,
          }),
          (moves) => {
            let template = layout();
            for (const [from, parent, index] of moves) {
              template = moveNodeTo(template, from, parent, index);
            }
            const ids = (nodes: readonly LayoutNode[]): string[] =>
              nodes.flatMap((n) => (n.kind === 'field' ? [n.fieldId] : ids(n.children)));
            expect(ids(template.layouts.full).sort()).toEqual(['nome', 'w', 'x', 'y', 'z']);
            expect(compiles(template)).toBe(true);
          },
        ),
      );
    });
  });
});

describe('nova ficha: abas, exibição e campo secundário', () => {
  /** Seção "Atributos" com for (valor) e for_mod (modificador). */
  const attributes = () => {
    let template = blank();
    ({ template } = addField(template, 'number', 'For', [0]));
    ({ template } = addField(template, 'computed', 'For mod', [0]));
    return template;
  };

  it('o secundário sai do próprio lugar e acompanha o campo principal', () => {
    const template = setFieldSecondary(attributes(), 'for_mod', 'for');
    expect(template.layouts.full[0]).toMatchObject({
      children: [{ fieldId: 'nome' }, { fieldId: 'for_mod', secondary: 'for' }],
    });
    expect(compiles(template)).toBe(true);
  });

  it('trocar ou desfazer o secundário devolve o anterior à ficha', () => {
    let template = setFieldSecondary(attributes(), 'for_mod', 'for');
    template = setFieldSecondary(template, 'for_mod', undefined);
    expect(outline(template.layouts.full)).toEqual([{ Personagem: ['nome', 'for_mod', 'for'] }]);
    expect(compiles(template)).toBe(true);

    template = setFieldSecondary(setFieldSecondary(template, 'for_mod', 'for'), 'for_mod', 'nome');
    expect(template.layouts.full[0]).toMatchObject({
      children: [{ fieldId: 'for_mod', secondary: 'nome' }, { fieldId: 'for' }],
    });
    expect(compiles(template)).toBe(true);
  });

  it('excluir o campo secundário limpa a referência', () => {
    const template = removeField(setFieldSecondary(attributes(), 'for_mod', 'for'), 'for');
    expect(template.layouts.full[0]).toMatchObject({ children: [{}, { fieldId: 'for_mod' }] });
    expect(JSON.stringify(template.layouts)).not.toContain('secondary');
  });

  it('aba e exibição da seção; valores vazios saem do arquivo', () => {
    let template = updateSection(blank(), [0], { tab: 'Principal', display: 'compacto' });
    expect(template.layouts.full[0]).toMatchObject({ tab: 'Principal', display: 'compacto' });
    template = updateSection(template, [0], { tab: '  ', display: 'padrao' });
    expect(template.layouts.full[0]).not.toHaveProperty('tab');
    expect(template.layouts.full[0]).not.toHaveProperty('display');
  });
});
