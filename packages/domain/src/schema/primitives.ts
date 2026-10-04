import { z } from 'zod';

/**
 * Limites de tamanho. Protegem o app contra arquivos importados degenerados ou maliciosos
 * (o import é a principal fronteira de confiança do sistema).
 */
export const LIMITS = {
  fields: 500,
  listItemFields: 30,
  listItems: 500,
  selectOptions: 100,
  layoutNodes: 1000,
  layoutDepth: 8,
  gmSummary: 12,
  tags: 10,
  text: 10_000,
  label: 100,
  description: 2_000,
  members: 50,
} as const;

/** Identificador estável (de campo, ficha, template…). Nunca exibido ao usuário. */
export const IdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Identificador inválido')
  // IDs viram chaves de objetos (`values[id]`). Nomes herdados de Object.prototype, como
  // `__proto__` e `constructor`, permitiriam corromper objetos a partir de um arquivo importado.
  .refine((id) => !(id in Object.prototype), 'Identificador reservado');
export type Id = z.infer<typeof IdSchema>;

/** Apelido de campo usado em fórmulas (`@for`). Minúsculas, números e `_`. */
export const KeySchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,39}$/,
    'Use letras minúsculas, números e "_" (começando por letra, até 40 caracteres)',
  );

export const LabelSchema = z.string().trim().min(1, 'Obrigatório').max(LIMITS.label);
export const DescriptionSchema = z.string().max(LIMITS.description);

/** Versão semântica simplificada: MAJOR.MINOR.PATCH. */
export const SemVerSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/, 'Versão inválida (use 1.0.0)');

export const FiniteNumberSchema = z.number().refine(Number.isFinite, 'Número inválido');
export const TimestampSchema = z.number().int().nonnegative();
