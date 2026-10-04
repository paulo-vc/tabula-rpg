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
  /**
   * Altera apenas os campos informados, de forma atômica. Usado na edição campo a campo,
   * para não regravar a ficha inteira (e não sobrescrever outra edição concorrente).
   * @returns `false` se a ficha não existe.
   */
  update(id: string, changes: SheetChanges): Promise<boolean>;
  delete(id: string): Promise<void>;
}

export interface SheetChanges {
  name?: string;
  /** Valores a substituir, por ID de campo. Os demais campos ficam intactos. */
  values?: CharacterSheet['values'];
  updatedAt: number;
}

/** Configurações e dados do dispositivo local. */
export interface DeviceRepository {
  /** ID estável deste dispositivo/usuário local, criado na primeira chamada. */
  getDeviceId(): Promise<string>;
}
