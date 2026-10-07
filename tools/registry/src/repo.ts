import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  addVersion,
  compareVersions,
  emptyIndex,
  GitHubLoginSchema,
  IdSchema,
  parseTemplateFile,
  SemVerSchema,
  templatePath,
  type Issue,
  type RegistryIndex,
  type Result,
} from '@tabula/domain';
import { z } from 'zod';

/**
 * Conteúdo do repositório da comunidade:
 *
 *   templates/<id>/<versão>.json   arquivo publicado (nunca muda depois de publicado)
 *   templates/<id>/registro.json   dona do sistema e data de cada versão
 *   index.json                     catálogo, gerado a partir dos anteriores
 *
 * Os pedidos de inclusão não tocam no `index.json` (que geraria conflitos entre pedidos
 * simultâneos): ele é regenerado quando um pedido entra na `main`.
 */
export const RecordSchema = z.object({
  owner: GitHubLoginSchema,
  versions: z.record(SemVerSchema, z.object({ publishedAt: z.iso.datetime() })),
});
export type TemplateRecord = z.infer<typeof RecordSchema>;

export const recordPath = (id: string) => `templates/${id}/registro.json`;

export interface RepoTemplate {
  record: unknown;
  /** Bytes de cada versão publicada, por versão. */
  files: Map<string, Uint8Array>;
  /** Arquivos com nome fora do padrão (são erro). */
  stray: string[];
}

export type RepoState = Map<string, RepoTemplate>;

/** Arquivo a gravar no repositório (caminho relativo à raiz). */
export interface RepoWrite {
  path: string;
  content: string;
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function readRepo(root: string): Promise<RepoState> {
  const state: RepoState = new Map();
  let ids: string[];
  try {
    ids = await readdir(join(root, 'templates'));
  } catch {
    return state; // repositório ainda vazio
  }
  for (const id of ids.sort()) {
    const dir = join(root, 'templates', id);
    const template: RepoTemplate = { record: undefined, files: new Map(), stray: [] };
    for (const name of (await readdir(dir)).sort()) {
      const path = `templates/${id}/${name}`;
      if (name === 'registro.json') {
        template.record = JSON.parse(await readFile(join(dir, name), 'utf-8'));
      } else if (
        SemVerSchema.safeParse(name.replace(/\.json$/, '')).success &&
        name.endsWith('.json')
      ) {
        template.files.set(name.replace(/\.json$/, ''), await readFile(join(dir, name)));
      } else {
        template.stray.push(path);
      }
    }
    state.set(id, template);
  }
  return state;
}

export async function applyWrites(root: string, writes: RepoWrite[]): Promise<void> {
  for (const { path, content } of writes) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

const problem = (path: string, message: string): Issue => ({
  code: 'repositorio-invalido',
  path: [path],
  message,
});

/**
 * Gera o catálogo a partir dos arquivos, verificando tudo: cada versão é um template
 * válido, está no caminho certo e consta do registro. Determinístico: os mesmos arquivos
 * geram sempre o mesmo `index.json`.
 */
export function buildIndex(state: RepoState): Result<RegistryIndex, Issue[]> {
  const problems: Issue[] = [];
  let index = emptyIndex(new Date(0).toISOString());
  let updatedAt = index.updatedAt;

  for (const [id, template] of state) {
    if (!IdSchema.safeParse(id).success) {
      problems.push(problem(`templates/${id}`, 'Pasta com id inválido'));
      continue;
    }
    for (const path of template.stray) problems.push(problem(path, 'Arquivo fora do padrão'));
    const record = RecordSchema.safeParse(template.record);
    if (!record.success) {
      problems.push(problem(recordPath(id), 'registro.json ausente ou inválido'));
      continue;
    }
    const recorded = Object.keys(record.data.versions);
    for (const version of recorded) {
      if (!template.files.has(version)) {
        problems.push(problem(recordPath(id), `A versão ${version} não tem arquivo`));
      }
    }
    const versions = [...template.files.keys()].sort(compareVersions);
    for (const version of versions) {
      const path = templatePath(id, version);
      const bytes = template.files.get(version) as Uint8Array;
      const published = record.data.versions[version];
      if (!published) {
        problems.push(problem(path, 'Versão ausente do registro.json'));
        continue;
      }
      const parsed = parseTemplateFile(new TextDecoder().decode(bytes), { id, version });
      if (!parsed.ok) {
        for (const issue of parsed.error) problems.push({ ...issue, path: [path, ...issue.path] });
        continue;
      }
      index = addVersion(index, parsed.value, {
        sha256: sha256(bytes),
        size: bytes.byteLength,
        publishedAt: published.publishedAt,
        owner: record.data.owner,
      });
      if (published.publishedAt > updatedAt) updatedAt = published.publishedAt;
    }
  }
  return problems.length > 0
    ? { ok: false, error: problems }
    : { ok: true, value: { ...index, updatedAt } };
}
