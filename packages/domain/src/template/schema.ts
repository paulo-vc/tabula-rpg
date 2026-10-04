import { z } from 'zod';
import { MAX_FORMULA_LENGTH } from '../formula';
import {
  DescriptionSchema,
  FiniteNumberSchema,
  IdSchema,
  KeySchema,
  LabelSchema,
  LIMITS,
  SemVerSchema,
} from '../schema/primitives';

const FormulaSourceSchema = z.string().max(MAX_FORMULA_LENGTH);

const fieldBase = {
  /** ID estável: valores da ficha são indexados por ele. Renomear o rótulo não quebra fichas. */
  id: IdSchema,
  /** Apelido usado em fórmulas (`@key`). */
  key: KeySchema,
  label: LabelSchema,
  description: DescriptionSchema.optional(),
  /** `gm`: visível apenas para o Mestre durante a sessão. */
  visibility: z.enum(['all', 'gm']).optional(),
};

const NumberFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('number'),
  default: FiniteNumberSchema.optional(),
  min: FiniteNumberSchema.optional(),
  max: FiniteNumberSchema.optional(),
  integer: z.boolean().optional(),
});

const TextFieldSchema = z.object({
  ...fieldBase,
  type: z.enum(['text', 'longtext']),
  default: z.string().max(LIMITS.text).optional(),
});

const BooleanFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('boolean'),
  default: z.boolean().optional(),
});

const SelectOptionSchema = z.object({ value: IdSchema, label: LabelSchema });

const SelectFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('select'),
  options: z.array(SelectOptionSchema).min(1).max(LIMITS.selectOptions),
  multiple: z.boolean().optional(),
  default: z.union([IdSchema, z.array(IdSchema).max(LIMITS.selectOptions)]).optional(),
});

/** Expressão de dados, ex.: "1d8+3". A rolagem é implementada numa fase futura. */
const DiceFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('dice'),
  default: z.string().max(LIMITS.label).optional(),
});

/** Recurso consumível com valor atual e máximo: HP, mana, sanidade, espaços de magia… */
const ResourceFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('resource'),
  /** Fórmula do máximo. Se ausente, o máximo é digitado na ficha. */
  max: FormulaSourceSchema.optional(),
  /** Valor inicial (atual e, se não houver fórmula, também do máximo). */
  default: FiniteNumberSchema.optional(),
});

/** Campo derivado: nunca é armazenado na ficha, é sempre calculado. */
const ComputedFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('computed'),
  formula: FormulaSourceSchema,
});

/** Campos permitidos dentro de itens de lista (sem fórmulas nem listas aninhadas). */
const ListItemFieldSchema = z.discriminatedUnion('type', [
  NumberFieldSchema,
  TextFieldSchema,
  BooleanFieldSchema,
  SelectFieldSchema,
  DiceFieldSchema,
]);

/** Lista de itens com a mesma estrutura: inventário, perícias, magias, ataques… */
const ListFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('list'),
  itemFields: z.array(ListItemFieldSchema).min(1).max(LIMITS.listItemFields),
  maxItems: z.number().int().min(1).max(LIMITS.listItems).optional(),
});

export const FieldDefSchema = z.discriminatedUnion('type', [
  NumberFieldSchema,
  TextFieldSchema,
  BooleanFieldSchema,
  SelectFieldSchema,
  DiceFieldSchema,
  ResourceFieldSchema,
  ComputedFieldSchema,
  ListFieldSchema,
]);

export type FieldDef = z.infer<typeof FieldDefSchema>;
export type ListItemFieldDef = z.infer<typeof ListItemFieldSchema>;
export type FieldType = FieldDef['type'];
export type FieldOf<T extends FieldType> = Extract<FieldDef, { type: T }>;

/** Tipos cujo valor pode ser usado em fórmulas. */
export const NUMERIC_FIELD_TYPES = ['number', 'boolean', 'resource', 'computed'] as const;

// ---------- Layout ----------

export type LayoutNode =
  | { kind: 'section'; title: string; columns: 1 | 2 | 3 | 4; children: LayoutNode[] }
  | { kind: 'field'; fieldId: string; span?: 1 | 2 | 3 | 4 | undefined };

const ColumnsSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const LayoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('section'),
      title: LabelSchema,
      columns: ColumnsSchema,
      children: z.array(LayoutNodeSchema).max(LIMITS.layoutNodes),
    }),
    z.object({
      kind: z.literal('field'),
      fieldId: IdSchema,
      span: ColumnsSchema.optional(),
    }),
  ]),
);

const LayoutSchema = z.array(LayoutNodeSchema).max(LIMITS.layoutNodes);

// ---------- Template ----------

/** De onde o template veio: embutido no app, repositório da comunidade ou criado localmente. */
export const TemplateSourceSchema = z.enum(['builtin', 'community', 'local']);
export type TemplateSource = z.infer<typeof TemplateSourceSchema>;

export const SystemTemplateSchema = z.object({
  id: IdSchema,
  version: SemVerSchema,
  name: LabelSchema,
  description: DescriptionSchema.optional(),
  author: LabelSchema.optional(),
  /** Licença do conteúdo (ex.: "CC-BY-4.0"). Obrigatória para publicar na comunidade. */
  license: LabelSchema.optional(),
  /** Idioma principal (ex.: "pt-BR"). */
  language: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)
    .optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(LIMITS.tags).optional(),
  source: TemplateSourceSchema,
  /** Versão mínima do app capaz de abrir este template. */
  minAppVersion: SemVerSchema.optional(),
  fields: z.array(FieldDefSchema).min(1).max(LIMITS.fields),
  layouts: z.object({
    /** Ficha completa. */
    full: LayoutSchema,
    /** Variante para telas pequenas. Se ausente, `full` é usado. */
    compact: LayoutSchema.optional(),
    /** Campos exibidos no card do jogador no painel do Mestre (HP, mana, condições…). */
    gmSummary: z.array(IdSchema).max(LIMITS.gmSummary).optional(),
  }),
});

export type SystemTemplate = z.infer<typeof SystemTemplateSchema>;

/** Referência de uma ficha (ou campanha) ao template em que se baseia. */
export const TemplateRefSchema = z.object({
  id: IdSchema,
  version: SemVerSchema,
  source: TemplateSourceSchema,
});
export type TemplateRef = z.infer<typeof TemplateRefSchema>;
