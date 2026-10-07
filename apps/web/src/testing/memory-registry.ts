import { createHash } from 'node:crypto';
import {
  addVersion,
  emptyIndex,
  serializeIndex,
  serializeTemplateFile,
  templatePath,
  type RegistryIndex,
  type SystemTemplate,
} from '@tabula/domain';
import type { RegistrySource, Sha256 } from '@/app/registry';

export const nodeSha256: Sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Repositório da comunidade em memória, publicado como a automação real faria. */
export class MemoryRegistrySource implements RegistrySource {
  readonly files = new Map<string, Uint8Array>();
  index: RegistryIndex = emptyIndex('2026-10-01T00:00:00.000Z');
  offline = false;
  requests: string[] = [];

  constructor() {
    this.writeIndex();
  }

  publish(template: SystemTemplate, owner = 'maria'): this {
    const bytes = new TextEncoder().encode(serializeTemplateFile(template));
    this.files.set(templatePath(template.id, template.version), bytes);
    this.index = addVersion(this.index, template, {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
      publishedAt: '2026-10-02T00:00:00.000Z',
      owner,
    });
    this.writeIndex();
    return this;
  }

  writeIndex(): void {
    this.files.set('index.json', new TextEncoder().encode(serializeIndex(this.index)));
  }

  async fetch(path: string, maxBytes: number): Promise<Uint8Array> {
    this.requests.push(path);
    if (this.offline) throw new Error('sem rede');
    const file = this.files.get(path);
    if (!file) throw new Error(`404 ${path}`);
    if (file.byteLength > maxBytes) throw new Error('grande demais');
    return file;
  }
}
