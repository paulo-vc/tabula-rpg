import {
  DexieDeviceRepository,
  DexieSheetRepository,
  DexieTemplateRepository,
  TabulaDatabase,
} from '@tabula/storage';
import { BUILTIN_TEMPLATES } from '@tabula/templates';
import { TemplateCatalog } from './catalog';
import { FileService } from './files';
import { SheetService, type Clock, type IdGenerator } from './sheets';

/** Raiz de composição: liga as portas do domínio às implementações concretas. */
export interface Services {
  catalog: TemplateCatalog;
  sheets: SheetService;
  files: FileService;
  /** Repositório de fichas para consultas reativas (listas). */
  sheetRepository: DexieSheetRepository;
}

export function createServices(
  db: TabulaDatabase = new TabulaDatabase(),
  clock: Clock = { now: () => Date.now() },
  ids: IdGenerator = { newId: () => crypto.randomUUID() },
): Services {
  const sheetRepository = new DexieSheetRepository(db);
  const templateRepository = new DexieTemplateRepository(db);
  const device = new DexieDeviceRepository(db, ids.newId);
  const catalog = new TemplateCatalog(templateRepository, BUILTIN_TEMPLATES);
  return {
    catalog,
    sheetRepository,
    sheets: new SheetService(sheetRepository, catalog, device, clock, ids),
    files: new FileService(sheetRepository, templateRepository, catalog, clock, ids),
  };
}
