import {
  addField,
  addSection,
  blankTemplate,
  updateSection,
  type LayoutNode,
  type SystemTemplate,
} from '@tabula/domain';
import { describe, expect, it } from 'vitest';
import { applyDrop } from './StructureEditor';

/** A [nome, x], B [y, z]; "solto" fora da ficha. */
function layout(): SystemTemplate {
  let template = updateSection(blankTemplate({ id: 't', name: 'T' }), [0], { title: 'A' });
  ({ template } = addField(template, 'number', 'X', [0]));
  template = addSection(template, 'B');
  ({ template } = addField(template, 'number', 'Y', [1]));
  ({ template } = addField(template, 'number', 'Z', [1]));
  template.fields.push({ id: 'solto', key: 'solto', label: 'Solto', type: 'number' });
  return template;
}

const outline = (nodes: readonly LayoutNode[]): unknown[] =>
  nodes.map((node) =>
    node.kind === 'field' ? node.fieldId : { [node.title]: outline(node.children) },
  );

const drop = (active: string, over: string) =>
  outline(applyDrop(layout(), active, over).layouts.full);

describe('arrastar e soltar', () => {
  it.each<[string, string, string, unknown[]]>([
    [
      'campo sobre campo da mesma seção',
      'campo:nome',
      'campo:x',
      [{ A: ['x', 'nome'] }, { B: ['y', 'z'] }],
    ],
    [
      'campo sobre campo de outra seção',
      'campo:x',
      'campo:z',
      [{ A: ['nome'] }, { B: ['y', 'x', 'z'] }],
    ],
    [
      'campo no fim de outra seção',
      'campo:nome',
      'dentro:1',
      [{ A: ['x'] }, { B: ['y', 'z', 'nome'] }],
    ],
    [
      'campo no fim da própria seção',
      'campo:y',
      'dentro:1',
      [{ A: ['nome', 'x'] }, { B: ['z', 'y'] }],
    ],
    [
      'campo solto sobre um campo',
      'campo:solto',
      'campo:y',
      [{ A: ['nome', 'x'] }, { B: ['solto', 'y', 'z'] }],
    ],
    [
      'campo solto no fim de uma seção',
      'campo:solto',
      'dentro:0',
      [{ A: ['nome', 'x', 'solto'] }, { B: ['y', 'z'] }],
    ],
    ['seção sobre seção', 'secao:1', 'secao:0', [{ B: ['y', 'z'] }, { A: ['nome', 'x'] }]],
  ])('%s', (_, active, over, expected) => {
    expect(drop(active, over)).toEqual(expected);
  });

  it('ignora soltar no mesmo lugar, seção dentro de campo e IDs desconhecidos', () => {
    const template = layout();
    expect(applyDrop(template, 'campo:x', 'campo:x')).toBe(template);
    expect(applyDrop(template, 'secao:0', 'campo:y')).toBe(template);
    expect(applyDrop(template, 'secao:0', 'dentro:1')).toBe(template);
    expect(applyDrop(template, 'outro:1', 'campo:y')).toBe(template);
  });
});
