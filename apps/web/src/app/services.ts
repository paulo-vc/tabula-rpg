import {
  DexieCampaignRepository,
  DexieDeviceRepository,
  DexieDraftRepository,
  DexieSecretValuesRepository,
  DexieSessionStateRepository,
  DexieSheetRepository,
  DexieTemplateRepository,
  TabulaDatabase,
} from '@tabula/storage';
import { BUILTIN_TEMPLATES } from '@tabula/templates';
import { CampaignService } from './campaigns';
import { TemplateEditorService } from './editor';
import { TemplateCatalog } from './catalog';
import { FileService } from './files';
import { randomSecret } from './invite-link';
import { LiveSessionManager, type TransportFactory } from './live-session';
import { RegistryService, type RegistrySource, type Sha256 } from './registry';
import { HttpRegistrySource, webSha256 } from './registry-http';
import { SheetService, type Clock, type IdGenerator } from './sheets';

/** Raiz de composição: liga as portas do domínio às implementações concretas. */
export interface Services {
  catalog: TemplateCatalog;
  sheets: SheetService;
  files: FileService;
  campaigns: CampaignService;
  session: LiveSessionManager;
  registry: RegistryService;
  editor: TemplateEditorService;
  device: DexieDeviceRepository;
  /** Repositórios para consultas reativas (listas). */
  sheetRepository: DexieSheetRepository;
  campaignRepository: DexieCampaignRepository;
}

export interface ServiceOptions {
  clock?: Clock;
  ids?: IdGenerator;
  newSecret?: () => string;
  /** Transporte da sessão ao vivo: WebRTC no app; rede em memória nos testes. */
  createTransport?: TransportFactory;
  /** Repositório de sistemas da comunidade: CDN no app; memória nos testes. */
  registrySource?: RegistrySource;
  sha256?: Sha256;
  appVersion?: string;
}

export function createServices(
  db: TabulaDatabase = new TabulaDatabase(),
  {
    clock = { now: () => Date.now() },
    ids = { newId: () => crypto.randomUUID() },
    newSecret = randomSecret,
    createTransport = () => {
      throw new Error('Transporte da sessão não configurado');
    },
    registrySource = new HttpRegistrySource(),
    sha256 = webSha256,
    appVersion = __APP_VERSION__,
  }: ServiceOptions = {},
): Services {
  const sheetRepository = new DexieSheetRepository(db);
  const templateRepository = new DexieTemplateRepository(db);
  const device = new DexieDeviceRepository(db, ids.newId);
  const campaignRepository = new DexieCampaignRepository(db);
  const catalog = new TemplateCatalog(templateRepository, BUILTIN_TEMPLATES);
  const sheets = new SheetService(sheetRepository, catalog, device, clock, ids);
  const sessionStates = new DexieSessionStateRepository(db);
  const secrets = new DexieSecretValuesRepository(db);
  const files = new FileService(sheetRepository, templateRepository, catalog, clock, ids);
  return {
    catalog,
    device,
    sheetRepository,
    campaignRepository,
    sheets,
    files,
    editor: new TemplateEditorService(
      new DexieDraftRepository(db),
      templateRepository,
      catalog,
      clock,
      ids,
    ),
    registry: new RegistryService(registrySource, catalog, files, sha256, appVersion),
    session: new LiveSessionManager(
      campaignRepository,
      sheetRepository,
      sessionStates,
      device,
      createTransport,
      clock,
      catalog,
      files,
      secrets,
    ),
    campaigns: new CampaignService(
      campaignRepository,
      sessionStates,
      secrets,
      sheetRepository,
      sheets,
      catalog,
      device,
      clock,
      ids,
      newSecret,
    ),
  };
}
