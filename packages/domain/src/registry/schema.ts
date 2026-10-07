import { z } from 'zod';
import { IdSchema, LabelSchema, LIMITS, SemVerSchema } from '../schema/primitives';
import { compareVersions } from '../version';

/**
 * Catálogo do repositório de templates da comunidade (`index.json`). É gerado pela
 * automação do repositório a cada publicação; ninguém o edita à mão.
 */
export const REGISTRY_FORMAT_VERSION = 1;

/** Tamanho máximo do arquivo de um template publicado (1 MB). */
export const MAX_TEMPLATE_BYTES = 1024 * 1024;

/** Tamanho máximo do índice (8 MB): milhares de sistemas, com folga. */
export const MAX_INDEX_BYTES = 8 * 1024 * 1024;

/** Login de uma conta do GitHub. */
export const GitHubLoginSchema = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, 'Usuário do GitHub inválido');

export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'Hash SHA-256 inválido');

export const RegistryVersionSchema = z.object({
  version: SemVerSchema,
  /** Hash do arquivo: o app recusa um download que não corresponda (CDN adulterado ou corrompido). */
  sha256: Sha256Schema,
  size: z.number().int().positive().max(MAX_TEMPLATE_BYTES),
  publishedAt: z.iso.datetime(),
  minAppVersion: SemVerSchema.optional(),
});
export type RegistryVersion = z.infer<typeof RegistryVersionSchema>;

export const RegistryEntrySchema = z.object({
  id: IdSchema,
  /** Metadados da versão mais recente, para a busca não precisar baixar o template. */
  name: LabelSchema,
  description: z.string().max(LIMITS.description).optional(),
  author: LabelSchema,
  license: LabelSchema,
  language: z.string().max(10).optional(),
  tags: z.array(z.string().max(30)).max(LIMITS.tags).optional(),
  /** Conta do GitHub dona do sistema: só ela publica novas versões dele. */
  owner: GitHubLoginSchema,
  versions: z.array(RegistryVersionSchema).min(1).max(500),
});
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

export const RegistryIndexSchema = z.object({
  formatVersion: z.literal(REGISTRY_FORMAT_VERSION),
  updatedAt: z.iso.datetime(),
  templates: z.array(RegistryEntrySchema).max(10_000),
});
export type RegistryIndex = z.infer<typeof RegistryIndexSchema>;

export const emptyIndex = (updatedAt: string): RegistryIndex => ({
  formatVersion: REGISTRY_FORMAT_VERSION,
  updatedAt,
  templates: [],
});

/** Versão mais recente publicada de um sistema. */
export function latestVersion(entry: RegistryEntry): RegistryVersion {
  return entry.versions.reduce((latest, current) =>
    compareVersions(current.version, latest.version) > 0 ? current : latest,
  );
}

/** Caminho do arquivo de uma versão no repositório. Versões publicadas nunca mudam. */
export const templatePath = (id: string, version: string) => `templates/${id}/${version}.json`;
