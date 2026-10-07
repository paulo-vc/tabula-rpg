import { SystemTemplateSchema, type SystemTemplate } from '@tabula/domain';
import dnd5eSrd from './dnd5e-srd.json';
import lendasD20Orc from './lendas-d20-orc.json';

/**
 * Templates embutidos no app. Ficam em JSON (o mesmo formato dos templates da comunidade)
 * e são validados ao carregar: um template nativo inválido é um bug e deve falhar cedo.
 */
export const BUILTIN_TEMPLATES: readonly SystemTemplate[] = [dnd5eSrd, lendasD20Orc].map((json) =>
  SystemTemplateSchema.parse(json),
);

export function getBuiltinTemplate(id: string): SystemTemplate | undefined {
  return BUILTIN_TEMPLATES.find((template) => template.id === id);
}
