import {
  DexieCampaignRepository,
  DexieDeviceRepository,
  DexieSheetRepository,
  DexieTemplateRepository,
  TabulaDatabase,
} from '@tabula/storage';
import { BUILTIN_TEMPLATES } from '@tabula/templates';
import { CampaignService } from './campaigns';
import { TemplateCatalog } from './catalog';
import { FileService } from './files';
import { randomSecret } from './invite-link';
import { SheetService, type Clock, type IdGenerator } from './sheets';

/** Raiz de composição: liga as portas do domínio às implementações concretas. */
export interface Services {
  catalog: TemplateCatalog;
  sheets: SheetService;
  files: FileService;
  campaigns: CampaignService;
  device: DexieDeviceRepository;
  /** Repositórios para consultas reativas (listas). */
  sheetRepository: DexieSheetRepository;
  campaignRepository: DexieCampaignRepository;
}

export function createServices(
  db: TabulaDatabase = new TabulaDatabase(),
  clock: Clock = { now: () => Date.now() },
  ids: IdGenerator = { newId: () => crypto.randomUUID() },
  newSecret: () => string = randomSecret,
): Services {
  const sheetRepository = new DexieSheetRepository(db);
  const templateRepository = new DexieTemplateRepository(db);
  const device = new DexieDeviceRepository(db, ids.newId);
  const campaignRepository = new DexieCampaignRepository(db);
  const catalog = new TemplateCatalog(templateRepository, BUILTIN_TEMPLATES);
  const sheets = new SheetService(sheetRepository, catalog, device, clock, ids);
  return {
    catalog,
    device,
    sheetRepository,
    campaignRepository,
    sheets,
    files: new FileService(sheetRepository, templateRepository, catalog, clock, ids),
    campaigns: new CampaignService(
      campaignRepository,
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
