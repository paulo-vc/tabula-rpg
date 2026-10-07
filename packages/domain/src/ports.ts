import type { Campaign } from './campaign/schema';
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

/**
 * Rascunho do criador de sistemas. Pode estar inválido enquanto é editado: só vira um
 * template instalado (validado) ao salvar.
 */
export interface TemplateDraft {
  id: string;
  template: SystemTemplate;
  /** ID do sistema instalado que este rascunho altera; ausente se nunca foi salvo. */
  editing?: string;
  updatedAt: number;
}

export interface DraftRepository {
  /** Salva ou substitui o rascunho com o mesmo `id`. */
  save(draft: TemplateDraft): Promise<void>;
  get(id: string): Promise<TemplateDraft | undefined>;
  /** Ordenados da alteração mais recente para a mais antiga. */
  list(): Promise<TemplateDraft[]>;
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

/** Campanhas deste dispositivo (como Mestre ou como jogador). */
export interface CampaignRepository {
  /** Salva ou substitui a campanha com o mesmo `id`. */
  save(campaign: Campaign): Promise<void>;
  get(id: string): Promise<Campaign | undefined>;
  /** Ordenadas da alteração mais recente para a mais antiga. */
  list(): Promise<Campaign[]>;
  delete(id: string): Promise<void>;
}

/** Configurações e dados do dispositivo local. */
export interface DeviceRepository {
  /** ID estável deste dispositivo/usuário local, criado na primeira chamada. */
  getDeviceId(): Promise<string>;
  /** Nome de exibição usado na última vez (para preencher formulários). */
  getDisplayName(): Promise<string | undefined>;
  setDisplayName(name: string): Promise<void>;
}

/**
 * Estado da sessão ao vivo guardado entre sessões (bytes opacos do motor de sincronização),
 * para continuar de onde parou. Um registro por ficha, do lado do Mestre e do jogador.
 */
export interface SessionStateRecord {
  campaignId: string;
  /** `mestre:<sheetId>` ou `jogador:<sheetId>`. */
  key: string;
  userId?: string;
  displayName?: string;
  state: Uint8Array;
  updatedAt: number;
}

export interface SessionStateRepository {
  list(campaignId: string): Promise<SessionStateRecord[]>;
  save(records: SessionStateRecord[]): Promise<void>;
  deleteCampaign(campaignId: string): Promise<void>;
}
