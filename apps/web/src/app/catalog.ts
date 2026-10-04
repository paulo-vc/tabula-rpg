import {
  compileTemplate,
  type CompiledTemplate,
  type SystemTemplate,
  type TemplateRepository,
} from '@tabula/domain';

/**
 * Todos os sistemas disponíveis: os nativos (embutidos no app) e os instalados pelo
 * usuário. Nativos têm prioridade e não podem ser substituídos.
 */
export class TemplateCatalog {
  private readonly compiled = new Map<string, CompiledTemplate>();

  constructor(
    private readonly installed: TemplateRepository,
    private readonly builtins: readonly SystemTemplate[],
  ) {}

  isBuiltin(id: string): boolean {
    return this.builtins.some((template) => template.id === id);
  }

  async get(id: string): Promise<SystemTemplate | undefined> {
    return this.builtins.find((template) => template.id === id) ?? this.installed.get(id);
  }

  /** Remove um sistema instalado. Fichas que o usam não são apagadas. */
  async remove(id: string): Promise<void> {
    if (this.isBuiltin(id)) throw new Error('Sistemas nativos não podem ser removidos');
    await this.installed.delete(id);
  }

  /** Nativos primeiro, depois os instalados por nome. */
  async list(): Promise<SystemTemplate[]> {
    const installed = await this.installed.list();
    return [...this.builtins, ...installed.filter((t) => !this.isBuiltin(t.id))];
  }

  /**
   * Template compilado, em cache por id e versão: o conteúdo de uma versão publicada não
   * muda. Templates do catálogo já foram validados ao entrar (nativos nos testes,
   * instalados pelo repositório); falhar aqui é um bug.
   */
  compile(template: SystemTemplate): CompiledTemplate {
    const key = `${template.id}@${template.version}`;
    const cached = this.compiled.get(key);
    if (cached) return cached;
    const result = compileTemplate(template);
    if (!result.ok) {
      throw new Error(`Template inválido no catálogo (${key}): ${result.error[0]?.message}`);
    }
    this.compiled.set(key, result.value);
    return result.value;
  }
}
