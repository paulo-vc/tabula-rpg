import {
  compareVersions,
  latestVersion,
  MAX_INDEX_BYTES,
  parseRegistryIndex,
  parseTemplateFile,
  templatePath,
  type RegistryEntry,
  type RegistryIndex,
  type SystemTemplate,
} from '@tabula/domain';
import type { TemplateCatalog } from './catalog';
import type { FileService, ImportResult } from './files';

/** Repositório público com os sistemas da comunidade (ver ADR 0006). */
export const REGISTRY_REPO = { owner: 'paulo-vc', name: 'tabula-templates', branch: 'main' };

/** Acesso de leitura aos arquivos do repositório (CDN no app; memória nos testes). */
export interface RegistrySource {
  /** Baixa um arquivo do repositório. Falha se passar de `maxBytes`. */
  fetch(path: string, maxBytes: number): Promise<Uint8Array>;
}

export type Sha256 = (bytes: Uint8Array) => Promise<string>;

export class RegistryError extends Error {
  constructor(
    readonly code: 'sem-conexao' | 'indice-invalido',
    message: string,
  ) {
    super(message);
  }
}

/** Situação de um sistema do catálogo neste dispositivo. */
export type EntryStatus =
  | { kind: 'disponivel' }
  | { kind: 'instalado' }
  | { kind: 'atualizacao'; installed: string }
  /** Mesmo id de um sistema nativo ou criado aqui: instalar substituiria outro sistema. */
  | { kind: 'conflito' }
  | { kind: 'requer-app-novo'; minAppVersion: string };

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Navegação, busca e instalação de sistemas da comunidade. */
export class RegistryService {
  constructor(
    private readonly source: RegistrySource,
    private readonly catalog: TemplateCatalog,
    private readonly files: FileService,
    private readonly sha256: Sha256,
    private readonly appVersion: string,
  ) {}

  async loadIndex(): Promise<RegistryIndex> {
    let bytes: Uint8Array;
    try {
      bytes = await this.source.fetch('index.json', MAX_INDEX_BYTES);
    } catch {
      throw new RegistryError(
        'sem-conexao',
        'Não foi possível acessar o catálogo da comunidade. Verifique a internet e tente de novo.',
      );
    }
    const parsed = parseRegistryIndex(new TextDecoder().decode(bytes));
    if (!parsed.ok) {
      throw new RegistryError(
        'indice-invalido',
        'O catálogo da comunidade não pôde ser lido. Talvez seja preciso atualizar o app.',
      );
    }
    return parsed.value;
  }

  /** Filtra por nome, descrição, autor e etiquetas, ignorando acentos e maiúsculas. */
  search(index: RegistryIndex, query: string): RegistryEntry[] {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return index.templates;
    return index.templates.filter((entry) => {
      const haystack = normalize(
        [entry.name, entry.description, entry.author, entry.id, ...(entry.tags ?? [])].join(' '),
      );
      return terms.every((term) => haystack.includes(term));
    });
  }

  statusOf(entry: RegistryEntry, installed: SystemTemplate | undefined): EntryStatus {
    const latest = latestVersion(entry);
    if (installed && installed.source !== 'community') return { kind: 'conflito' };
    if (installed && compareVersions(installed.version, latest.version) >= 0) {
      return { kind: 'instalado' };
    }
    if (latest.minAppVersion && compareVersions(latest.minAppVersion, this.appVersion) > 0) {
      return { kind: 'requer-app-novo', minAppVersion: latest.minAppVersion };
    }
    return installed
      ? { kind: 'atualizacao', installed: installed.version }
      : { kind: 'disponivel' };
  }

  /** Sistemas instalados da comunidade que têm versão nova no catálogo. */
  async updates(index: RegistryIndex): Promise<Map<string, string>> {
    const updates = new Map<string, string>();
    for (const template of await this.catalog.list()) {
      const entry = index.templates.find((e) => e.id === template.id);
      if (entry && this.statusOf(entry, template).kind === 'atualizacao') {
        updates.set(template.id, latestVersion(entry).version);
      }
    }
    return updates;
  }

  /**
   * Baixa e instala a versão mais recente. O arquivo só é aceito se corresponder ao hash
   * do catálogo e passar pela mesma validação de um arquivo importado.
   */
  async install(entry: RegistryEntry): Promise<ImportResult> {
    const status = this.statusOf(entry, await this.catalog.get(entry.id));
    if (status.kind === 'conflito') {
      return failure('conflito', `Já existe outro sistema com o id "${entry.id}" neste aparelho.`);
    }
    if (status.kind === 'requer-app-novo') {
      return failure(
        'requer-app-novo',
        `"${entry.name}" precisa do Tabula ${status.minAppVersion} ou mais novo. Atualize o app.`,
      );
    }

    const latest = latestVersion(entry);
    let bytes: Uint8Array;
    try {
      bytes = await this.source.fetch(templatePath(entry.id, latest.version), latest.size);
    } catch {
      return failure('sem-conexao', 'Não foi possível baixar o sistema. Tente de novo.');
    }
    if (bytes.byteLength !== latest.size || (await this.sha256(bytes)) !== latest.sha256) {
      return failure(
        'arquivo-corrompido',
        'O arquivo baixado não confere com o catálogo. Tente de novo mais tarde.',
      );
    }
    const template = parseTemplateFile(new TextDecoder().decode(bytes), {
      id: entry.id,
      version: latest.version,
    });
    if (!template.ok) return { ok: false, issues: template.error };
    return this.files.installTemplate(template.value);
  }

  /**
   * Formulário de publicação no GitHub, já preenchido. O arquivo do sistema é anexado
   * pelo usuário; a automação do repositório valida e abre o pedido de inclusão.
   */
  publishUrl(template: SystemTemplate): string {
    const { owner, name } = REGISTRY_REPO;
    const params = new URLSearchParams({
      template: 'publicar.yml',
      title: `Publicar: ${template.name} ${template.version}`,
    });
    if (template.author) params.set('autor', template.author);
    return `https://github.com/${owner}/${name}/issues/new?${params}`;
  }
}

const failure = (code: string, message: string): ImportResult => ({
  ok: false,
  issues: [{ code, path: [], message }],
});
