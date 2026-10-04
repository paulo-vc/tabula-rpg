import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION } from '../format';
import { createSheet } from '../sheet/operations';
import { compiledMiniTemplate, miniTemplate } from '../testing/fixtures';
import { MAX_IMPORT_BYTES, parseExport, serializeExport, type ExportEnvelope } from './envelope';

const exportedAt = '2026-10-04T12:00:00.000Z';

const templateEnvelope = (): ExportEnvelope => ({
  kind: 'tabula/template',
  formatVersion: FORMAT_VERSION,
  exportedAt,
  payload: miniTemplate(),
});

const sheetEnvelope = (): ExportEnvelope => ({
  kind: 'tabula/sheet',
  formatVersion: FORMAT_VERSION,
  exportedAt,
  payload: createSheet(compiledMiniTemplate(), { id: 's1', name: 'Thorin', ownerId: 'u1', now: 0 }),
  template: miniTemplate(),
});

const codes = (text: string) => {
  const result = parseExport(text);
  return result.ok ? [] : result.error.map((issue) => issue.code);
};

describe('parseExport', () => {
  it.each([
    ['template', templateEnvelope],
    ['ficha com template embutido', sheetEnvelope],
  ])('lê de volta um(a) %s exportado(a)', (_, build) => {
    const envelope = build();
    expect(parseExport(serializeExport(envelope))).toEqual({ ok: true, value: envelope });
  });

  it('descarta propriedades desconhecidas', () => {
    const text = JSON.stringify({
      ...templateEnvelope(),
      extra: 'x',
      payload: { ...miniTemplate(), lixo: 1 },
    });
    const result = parseExport(text);
    expect(result.ok && result.value).not.toHaveProperty('extra');
    expect(result.ok && result.value.payload).not.toHaveProperty('lixo');
  });

  it('rejeita JSON inválido', () => {
    expect(codes('{ "kind": ')).toEqual(['json-invalido']);
  });

  it('rejeita arquivos grandes demais antes de interpretar', () => {
    expect(codes(' '.repeat(MAX_IMPORT_BYTES + 1))).toEqual(['arquivo-grande-demais']);
  });

  it('pede atualização para formato mais novo', () => {
    const text = JSON.stringify({ ...templateEnvelope(), formatVersion: FORMAT_VERSION + 1 });
    expect(codes(text)).toEqual(['formato-mais-novo']);
  });

  it.each([
    ['tipo de arquivo desconhecido', { kind: 'tabula/mapa' }],
    ['sem versão de formato', { formatVersion: undefined }],
    ['data inválida', { exportedAt: 'ontem' }],
    ['JSON que não é objeto', null],
  ])('rejeita %s', (_, override) => {
    const text = JSON.stringify(override === null ? 42 : { ...templateEnvelope(), ...override });
    expect(codes(text)).toContain('schema-invalido');
  });

  it('aponta o caminho de erros de schema', () => {
    const envelope = templateEnvelope();
    const fields = (envelope.payload as { fields: { key: string }[] }).fields;
    (fields[5] as { key: string }).key = 'Força';
    const result = parseExport(JSON.stringify(envelope));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.path).toEqual(['payload', 'fields', 5, 'key']);
  });

  it('valida as regras semânticas do template, inclusive o embutido na ficha', () => {
    const envelope = sheetEnvelope();
    if (envelope.kind !== 'tabula/sheet' || !envelope.template) throw new Error('fixture');
    const ca = envelope.template.fields.find((f) => f.id === 'f_ca') as { formula: string };
    ca.formula = '@ca';
    const result = parseExport(JSON.stringify(envelope));
    expect(result).toMatchObject({
      ok: false,
      error: [{ code: 'dependencia-circular', path: ['template', 'fields'] }],
    });
  });

  // `value` padrão é um valor de campo válido: assim, só o ID reservado pode causar a rejeição.
  const withReservedKey = (reserved: string, value = '7') =>
    JSON.stringify(sheetEnvelope()).replace('"values":{', `"values":{"${reserved}":${value},`);

  it('descarta a chave __proto__ sem alterar protótipos (poluição de protótipo)', () => {
    const result = parseExport(withReservedKey('__proto__', '{"polluted":true}'));
    if (!result.ok || result.value.kind !== 'tabula/sheet') throw new Error('deveria ler a ficha');
    const values = result.value.payload.values;
    expect(Object.hasOwn(values, '__proto__')).toBe(false);
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each(['constructor', 'toString', 'hasOwnProperty'])(
    'recusa o ID reservado %s nos valores da ficha',
    (reserved) => {
      expect(codes(withReservedKey(reserved))).toContain('schema-invalido');
    },
  );

  it('recusa layout aninhado de forma maliciosa sem estourar a pilha', () => {
    const depth = 20_000;
    const nested =
      '{"kind":"section","title":"S","columns":1,"children":['.repeat(depth) + ']}'.repeat(depth);
    const text = JSON.stringify(templateEnvelope()).replace('"full":[', `"full":[${nested},`);
    expect(text.length).toBeLessThan(MAX_IMPORT_BYTES); // garante que o limite de tamanho não é o motivo
    expect(codes(text)).toEqual(['estrutura-invalida']);
  });
});
