import type { CharacterSheet } from './sheet/schema';
import type { SystemTemplate } from './template/schema';

/**
 * Portas de persistência. O domínio e a aplicação dependem destas interfaces; a
 * implementação (IndexedDB, memória em testes…) fica em `@tabula/storage`.
 */

/** Templates instalados pelo usuário (comunidade ou criados localmente). Um por `id`. */
export interface TemplateRepository {
  /** Salva ou substitui o template com o mesmo `id`. */
  save(template: SystemTemplate): Promise<void>;
  get(id: string): Promise<SystemTemplate | undefined>;
  /** Ordenados por nome. */
  list(): Promise<SystemTemplate[]>;
  delete(id: string): Promise<void>;
}

export interface SheetRepository {
  /** Salva ou substitui a ficha com o mesmo `id`. */
  save(sheet: CharacterSheet): Promise<void>;
  get(id: string): Promise<CharacterSheet | undefined>;
  /** Ordenadas da alteração mais recente para a mais antiga. */
  list(): Promise<CharacterSheet[]>;
  /** Fichas baseadas em um template, para atualizar todas quando ele mudar. */
  listByTemplate(templateId: string): Promise<CharacterSheet[]>;
  delete(id: string): Promise<void>;
}
