import { compareVersions, SemVerSchema } from '@tabula/domain';
import { z } from 'zod';

/** Repositório do app, onde ficam as versões publicadas (GitHub Releases). */
export const APP_REPO = { owner: 'paulo-vc', name: 'tabula-rpg' };

export const releasesUrl = `https://github.com/${APP_REPO.owner}/${APP_REPO.name}/releases`;
export const newIssueUrl = `https://github.com/${APP_REPO.owner}/${APP_REPO.name}/issues/new/choose`;

const ReleaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.url().startsWith('https://github.com/'),
  draft: z.boolean(),
});

export interface AvailableUpdate {
  version: string;
  url: string;
}

/** Lê JSON de um endereço (injetado: `fetch` no app, dados fixos nos testes). */
export type FetchJson = (url: string) => Promise<unknown>;

export const fetchJson: FetchJson = async (url) => {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

/**
 * Verifica se há versão mais nova do app desktop. A versão web se atualiza sozinha (PWA);
 * no desktop, o app avisa e leva à página de download. Sem internet, simplesmente não avisa.
 */
export async function checkForUpdate(
  currentVersion: string,
  load: FetchJson = fetchJson,
): Promise<AvailableUpdate | null> {
  let data: unknown;
  try {
    data = await load(
      `https://api.github.com/repos/${APP_REPO.owner}/${APP_REPO.name}/releases?per_page=10`,
    );
  } catch {
    return null;
  }
  const releases = z.array(z.unknown()).safeParse(data);
  if (!releases.success) return null;

  let best: AvailableUpdate | null = null;
  for (const raw of releases.data) {
    const release = ReleaseSchema.safeParse(raw);
    if (!release.success || release.data.draft) continue;
    const version = release.data.tag_name.replace(/^v/, '');
    if (!SemVerSchema.safeParse(version).success) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = { version, url: release.data.html_url };
  }
  return best && compareVersions(best.version, currentVersion) > 0 ? best : null;
}
