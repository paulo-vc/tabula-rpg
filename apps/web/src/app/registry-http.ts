import { REGISTRY_REPO, type RegistrySource, type Sha256 } from './registry';

const TIMEOUT_MS = 15_000;

/**
 * Lê o repositório pela CDN gratuita jsDelivr (cache global; a automação do repositório
 * limpa o cache do índice a cada publicação). Se a CDN falhar, tenta o GitHub direto.
 */
export class HttpRegistrySource implements RegistrySource {
  private readonly mirrors: string[];

  constructor(repo = REGISTRY_REPO) {
    this.mirrors = [
      `https://cdn.jsdelivr.net/gh/${repo.owner}/${repo.name}@${repo.branch}/`,
      `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.branch}/`,
    ];
  }

  async fetch(path: string, maxBytes: number): Promise<Uint8Array> {
    let lastError: unknown;
    for (const base of this.mirrors) {
      try {
        return await download(base + path, maxBytes);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

/** Download com tempo e tamanho máximos: um servidor lento ou um arquivo enorme não travam o app. */
async function download(url: string, maxBytes: number): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} em ${url}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Arquivo maior que ${maxBytes} bytes em ${url}`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export const webSha256: Sha256 = async (bytes) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};
