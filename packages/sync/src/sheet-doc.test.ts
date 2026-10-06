import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deepEqual, readSheet, reconcile, VALUES } from './sheet-doc';
import { newSheet, withValue } from './test-helpers';

describe('reconcile/readSheet', () => {
  it('ida e volta: a ficha lida é a escrita', () => {
    const doc = new Y.Doc();
    const sheet = withValue(newSheet('s1', 'u1'), 'itens', [
      { id: 'i1', values: { nome: 'Corda' } },
    ]);
    reconcile(doc, sheet);
    expect(readSheet(doc)).toEqual({
      id: 's1',
      name: 'Ficha s1',
      ownerId: 'u1',
      templateRef: sheet.templateRef,
      values: sheet.values,
      invalidValues: 0,
    });
  });

  it('escreve só a diferença (nenhuma atualização quando nada mudou)', () => {
    const doc = new Y.Doc();
    const sheet = newSheet('s1', 'u1');
    reconcile(doc, sheet);
    let updates = 0;
    doc.on('update', () => updates++);

    reconcile(doc, JSON.parse(JSON.stringify(sheet))); // mesmo conteúdo, outros objetos
    expect(updates).toBe(0);

    reconcile(doc, withValue(sheet, 'forca', 18));
    expect(updates).toBe(1);
    expect(doc.getMap(VALUES).get('forca')).toBe(18);
  });

  it('remove campos que deixaram de existir na ficha', () => {
    const doc = new Y.Doc();
    const sheet = newSheet('s1', 'u1');
    reconcile(doc, sheet);
    const { forca: _removed, ...rest } = sheet.values;
    reconcile(doc, { ...sheet, values: rest });
    expect(readSheet(doc)?.values).not.toHaveProperty('forca');
  });

  it('descarta valores inválidos vindos da rede e conta quantos', () => {
    const doc = new Y.Doc();
    reconcile(doc, newSheet('s1', 'u1'));
    const values = doc.getMap(VALUES);
    values.set('forca', Number.NaN);
    values.set('chave inválida!', 1);
    values.set('obj', { qualquer: 'coisa' });
    const snapshot = readSheet(doc);
    expect(snapshot?.invalidValues).toBe(3);
    expect(snapshot?.values).not.toHaveProperty('forca');
  });

  it('documento sem metadados válidos não é uma ficha', () => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('id', 'ok');
    expect(readSheet(doc)).toBeNull();
  });

  it('deepEqual ignora a ordem das chaves e compara listas', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });
});
