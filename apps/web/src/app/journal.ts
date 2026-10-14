import {
  err,
  JOURNAL_TEXT_LIMIT,
  newestFirst,
  ok,
  type Issue,
  type JournalEntry,
  type JournalRepository,
  type Result,
} from '@tabula/domain';
import type { Clock, IdGenerator } from './sheets';

export interface JournalDraft {
  title: string;
  text: string;
  /** Compartilhada com a mesa (diário) ou só do Mestre (nota). */
  shared: boolean;
}

const invalid = (message: string): Result<never, Issue> =>
  err({ code: 'entrada-invalida', path: [], message });

function check(draft: JournalDraft): Result<JournalDraft, Issue> {
  const title = draft.title.trim();
  if (!title) return invalid('Dê um título à entrada.');
  if (title.length > 100) return invalid('O título pode ter até 100 caracteres.');
  if (draft.text.length > JOURNAL_TEXT_LIMIT) {
    return invalid(
      `O texto pode ter até ${JOURNAL_TEXT_LIMIT.toLocaleString('pt-BR')} caracteres.`,
    );
  }
  return ok({ ...draft, title });
}

/**
 * Diário da campanha, do lado do Mestre: notas (só dele) e entradas compartilhadas com a
 * mesa. Com a sessão aberta, as compartilhadas seguem para os jogadores sozinhas (o
 * `LiveSessionManager` acompanha o banco).
 */
export class JournalService {
  constructor(
    private readonly journal: JournalRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** Da mais recente para a mais antiga. */
  async list(campaignId: string): Promise<JournalEntry[]> {
    return newestFirst(await this.journal.list(campaignId));
  }

  async create(campaignId: string, draft: JournalDraft): Promise<Result<JournalEntry, Issue>> {
    const checked = check(draft);
    if (!checked.ok) return checked;
    const now = this.clock.now();
    const entry: JournalEntry = {
      id: this.ids.newId(),
      ...checked.value,
      createdAt: now,
      updatedAt: now,
    };
    await this.journal.save(campaignId, entry);
    return ok(entry);
  }

  async update(
    campaignId: string,
    entryId: string,
    draft: JournalDraft,
  ): Promise<Result<JournalEntry, Issue>> {
    const checked = check(draft);
    if (!checked.ok) return checked;
    const current = (await this.journal.list(campaignId)).find((e) => e.id === entryId);
    if (!current) return invalid('Esta entrada não existe mais.');
    // `updatedAt` sempre avança: é por ele que a mesa sabe que a entrada mudou.
    const entry: JournalEntry = {
      ...current,
      ...checked.value,
      updatedAt: Math.max(this.clock.now(), current.updatedAt + 1),
    };
    await this.journal.save(campaignId, entry);
    return ok(entry);
  }

  async delete(campaignId: string, entryId: string): Promise<void> {
    await this.journal.delete(campaignId, entryId);
  }
}
