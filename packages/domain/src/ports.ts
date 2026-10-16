import type { Campaign } from './campaign/schema';
import type { RollEntry } from './dice/log';
import type { ChatMessage } from './chat/schema';
import type { JournalEntry } from './journal/schema';
import type { StoredImage } from './cutscene/schema';
import type { CharacterSheet, FieldValue } from './sheet/schema';
import type { Portrait } from './sheet/portrait';
import type { SoundSettings } from './preferences/sounds';
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
  /** Novo retrato; `null` remove. */
  portrait?: Portrait | null;
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
  /** Preferências de som (as padrão, se nunca foram salvas ou estão inválidas). */
  getSoundSettings(): Promise<SoundSettings>;
  setSoundSettings(settings: SoundSettings): Promise<void>;
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

/**
 * Valores dos campos secretos (visíveis só para o Mestre) das fichas dos jogadores. Ficam
 * apenas no aparelho do Mestre: nunca entram no documento sincronizado com o jogador.
 */
export interface SecretValuesRecord {
  campaignId: string;
  sheetId: string;
  values: Record<string, FieldValue>;
  updatedAt: number;
}

export interface SecretValuesRepository {
  get(campaignId: string, sheetId: string): Promise<SecretValuesRecord | undefined>;
  /** Altera só os campos informados, de forma atômica. */
  update(
    campaignId: string,
    sheetId: string,
    values: Record<string, FieldValue>,
    updatedAt: number,
  ): Promise<void>;
  deleteCampaign(campaignId: string): Promise<void>;
}

/**
 * Chave privada do Mestre de uma campanha (assina a prova de identidade). Fica só no
 * aparelho do Mestre: nunca vai ao convite, ao documento sincronizado nem a exportações.
 */
export interface GmKeyRecord {
  campaignId: string;
  secretKey: string;
}

export interface GmKeyRepository {
  get(campaignId: string): Promise<GmKeyRecord | undefined>;
  save(record: GmKeyRecord): Promise<void>;
  deleteCampaign(campaignId: string): Promise<void>;
}

/**
 * Diário da campanha. No aparelho do Mestre: todas as entradas (notas e compartilhadas). No
 * aparelho do jogador: só as que o Mestre compartilhou.
 */
export interface JournalRepository {
  list(campaignId: string): Promise<JournalEntry[]>;
  save(campaignId: string, entry: JournalEntry): Promise<void>;
  delete(campaignId: string, entryId: string): Promise<void>;
  /** Apaga as entradas que não estão em `keep` (o Mestre deixou de compartilhar). */
  keepOnly(campaignId: string, keep: readonly string[]): Promise<void>;
  deleteCampaign(campaignId: string): Promise<void>;
}

/** Uma imagem com o conteúdo. */
export interface ImageWithData {
  meta: StoredImage;
  data: Uint8Array;
}

/**
 * Imagens da campanha: a galeria do Mestre (`galeria`) e, no jogador, as recebidas ao ver
 * uma cutscene (`recebida`, guardadas para não baixar de novo).
 */
export interface ImageRepository {
  /** Só os dados (sem o conteúdo), das mais recentes para as mais antigas. */
  list(campaignId: string, origin: StoredImage['origin']): Promise<StoredImage[]>;
  get(campaignId: string, imageId: string): Promise<ImageWithData | undefined>;
  findByHash(campaignId: string, hash: string): Promise<ImageWithData | undefined>;
  save(campaignId: string, image: ImageWithData): Promise<void>;
  delete(campaignId: string, imageId: string): Promise<void>;
  deleteCampaign(campaignId: string): Promise<void>;
}

/** Registro de rolagens da sessão, por campanha (as mais antigas saem após `LOG_LIMIT`). */
export interface RollLogRepository {
  /** Da mais antiga para a mais recente. */
  list(campaignId: string): Promise<RollEntry[]>;
  /** Acrescenta as rolagens novas (as já registradas, pelo `id`, são ignoradas). */
  add(campaignId: string, entries: readonly RollEntry[]): Promise<void>;
  deleteCampaign(campaignId: string): Promise<void>;
}

/**
 * Chat da sessão, por campanha (as mais antigas saem após `CHAT_LIMIT`). Cada aparelho guarda
 * só o que viu: os sussurros de outras pessoas nunca chegam a ele.
 */
export interface ChatRepository {
  /** Da mais antiga para a mais recente. */
  list(campaignId: string): Promise<ChatMessage[]>;
  /** Acrescenta as mensagens novas (as já guardadas, pelo `id`, são ignoradas). */
  add(campaignId: string, messages: readonly ChatMessage[]): Promise<void>;
  deleteCampaign(campaignId: string): Promise<void>;
}
