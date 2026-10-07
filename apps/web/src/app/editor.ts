import {
  blankTemplate,
  bumpVersion,
  compareVersions,
  contentChanged,
  copyTemplate,
  templateIdFromName,
  type DraftRepository,
  type Issue,
  type SystemTemplate,
  type TemplateDraft,
  type TemplateRepository,
  validateTemplate,
} from '@tabula/domain';
import type { TemplateCatalog } from './catalog';
import type { Clock, IdGenerator } from './sheets';

export type SaveResult =
  { ok: true; template: SystemTemplate; bumped: boolean } | { ok: false; issues: Issue[] };

const failure = (code: string, message: string, path: Issue['path'] = []): SaveResult => ({
  ok: false,
  issues: [{ code, path, message }],
});

/**
 * Casos de uso do criador de sistemas. O usuário edita um rascunho (gravado a cada
 * alteração, mesmo inválido); salvar valida e instala o sistema como local.
 */
export class TemplateEditorService {
  constructor(
    private readonly drafts: DraftRepository,
    private readonly templates: TemplateRepository,
    private readonly catalog: TemplateCatalog,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** IDs ocupados por sistemas instalados e por outros rascunhos. */
  private async takenIds(exceptDraft?: string): Promise<Set<string>> {
    const installed = await this.catalog.list();
    const drafts = await this.drafts.list();
    return new Set([
      ...installed.map((t) => t.id),
      ...drafts.filter((d) => d.id !== exceptDraft).map((d) => d.template.id),
    ]);
  }

  private async create(template: SystemTemplate, editing?: string): Promise<TemplateDraft> {
    const draft: TemplateDraft = {
      id: this.ids.newId(),
      template,
      ...(editing && { editing }),
      updatedAt: this.clock.now(),
    };
    await this.drafts.save(draft);
    return draft;
  }

  async createBlank(name: string, author?: string): Promise<TemplateDraft> {
    const id = templateIdFromName(name, await this.takenIds());
    return this.create(blankTemplate({ id, name, ...(author && { author }) }));
  }

  /** Novo sistema a partir de outro (ex.: uma variante do D&D). */
  async createCopy(templateId: string): Promise<TemplateDraft> {
    const base = await this.catalog.get(templateId);
    if (!base) throw new Error(`Sistema inexistente: ${templateId}`);
    const name = `${base.name} (cópia)`.slice(0, 100);
    return this.create(
      copyTemplate(base, { id: templateIdFromName(name, await this.takenIds()), name }),
    );
  }

  /** Edita um sistema criado no aparelho. Reaproveita o rascunho em aberto, se houver. */
  async edit(templateId: string): Promise<TemplateDraft> {
    const existing = (await this.drafts.list()).find((d) => d.editing === templateId);
    if (existing) return existing;
    const template = await this.templates.get(templateId);
    if (!template || template.source !== 'local') {
      throw new Error(`Só sistemas criados no aparelho podem ser editados: ${templateId}`);
    }
    return this.create(template, templateId);
  }

  get(draftId: string): Promise<TemplateDraft | undefined> {
    return this.drafts.get(draftId);
  }

  list(): Promise<TemplateDraft[]> {
    return this.drafts.list();
  }

  async update(draftId: string, template: SystemTemplate): Promise<void> {
    const draft = await this.drafts.get(draftId);
    if (!draft) return;
    await this.drafts.save({ ...draft, template, updatedAt: this.clock.now() });
  }

  async discard(draftId: string): Promise<void> {
    await this.drafts.delete(draftId);
  }

  /**
   * Valida e instala o sistema. Se o conteúdo mudou e a versão não foi aumentada, aumenta
   * a versão de correção (1.0.0 → 1.0.1): fichas e jogadores de campanhas recebem a
   * atualização.
   */
  async save(draftId: string): Promise<SaveResult> {
    const draft = await this.drafts.get(draftId);
    if (!draft) return failure('rascunho-inexistente', 'O rascunho não existe mais.');
    let template: SystemTemplate = { ...draft.template, source: 'local' };

    if (draft.editing && template.id !== draft.editing) {
      return failure('id-alterado', 'O identificador de um sistema salvo não pode mudar.', ['id']);
    }
    if (!draft.editing && (await this.takenIds(draftId)).has(template.id)) {
      return failure(
        'id-em-uso',
        `Já existe um sistema com o identificador "${template.id}". Escolha outro em Informações.`,
        ['id'],
      );
    }
    const validated = validateTemplate(template);
    if (!validated.ok) return { ok: false, issues: validated.error };
    template = validated.value.template;

    let bumped = false;
    const current = draft.editing ? await this.templates.get(draft.editing) : undefined;
    if (current) {
      const comparison = compareVersions(template.version, current.version);
      if (comparison < 0) {
        return failure(
          'versao-anterior',
          `A versão salva é ${current.version}. A nova não pode ser menor.`,
          ['version'],
        );
      }
      if (comparison === 0 && contentChanged(current, template)) {
        template = { ...template, version: bumpVersion(current.version, 'patch') };
        bumped = true;
      }
    }

    await this.templates.save(template);
    await this.drafts.delete(draftId);
    return { ok: true, template, bumped };
  }
}
