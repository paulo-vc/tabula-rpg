import {
  compileTemplate,
  createSheet,
  type CharacterSheet,
  type SystemTemplate,
} from '@tabula/domain';

/** Template mínimo para os testes de sincronização. */
export const TEMPLATE: SystemTemplate = {
  id: 'teste',
  version: '1.0.0',
  name: 'Sistema de Teste',
  source: 'local',
  fields: [
    { id: 'nome', key: 'nome', label: 'Nome', type: 'text' },
    { id: 'forca', key: 'forca', label: 'Força', type: 'number', default: 10 },
    { id: 'hp', key: 'hp', label: 'PV', type: 'resource', default: 10 },
    { id: 'envenenado', key: 'envenenado', label: 'Envenenado', type: 'boolean' },
    {
      id: 'itens',
      key: 'itens',
      label: 'Itens',
      type: 'list',
      itemFields: [{ id: 'nome', key: 'nome', label: 'Item', type: 'text' }],
    },
  ],
  layouts: { full: [] },
};

export function newSheet(id: string, ownerId: string, name = `Ficha ${id}`): CharacterSheet {
  const compiled = compileTemplate(TEMPLATE);
  if (!compiled.ok) throw new Error('template de teste inválido');
  return createSheet(compiled.value, { id, name, ownerId, now: 0 });
}

export const withValue = (
  sheet: CharacterSheet,
  fieldId: string,
  value: CharacterSheet['values'][string],
): CharacterSheet => ({ ...sheet, values: { ...sheet.values, [fieldId]: value } });
