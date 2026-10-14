import { z } from 'zod';
import { IdSchema, LabelSchema, TimestampSchema } from '../schema/primitives';

/** Tamanho máximo do texto de uma entrada (cabe com folga numa mensagem da sessão). */
export const JOURNAL_TEXT_LIMIT = 20_000;
/** Quantas entradas compartilhadas o Mestre envia à mesa. */
export const JOURNAL_SHARED_LIMIT = 500;

/**
 * Entrada do diário da campanha. Fica no aparelho do Mestre; as `shared` vão à mesa na
 * sessão e ficam guardadas no aparelho de cada jogador (para ler fora da sessão). As não
 * compartilhadas são as notas do Mestre: nunca saem do aparelho dele.
 */
export const JournalEntrySchema = z.object({
  id: IdSchema,
  title: LabelSchema,
  text: z.string().max(JOURNAL_TEXT_LIMIT),
  shared: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

/** Da mais recente para a mais antiga (pela criação), como um diário lido de cima. */
export const newestFirst = (entries: readonly JournalEntry[]): JournalEntry[] =>
  [...entries].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));

/** O que vai à mesa: só as compartilhadas, as mais recentes primeiro, até o limite. */
export const sharedEntries = (entries: readonly JournalEntry[]): JournalEntry[] =>
  newestFirst(entries.filter((entry) => entry.shared)).slice(0, JOURNAL_SHARED_LIMIT);
