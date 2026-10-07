// Copia o esqueleto do repositório da comunidade e a CLI empacotada para uma pasta (o clone
// local do repositório da comunidade). Uso: pnpm --filter @tabula/registry export <pasta>
import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('Uso: pnpm --filter @tabula/registry export <pasta do repositório da comunidade>');
  process.exit(2);
}
const dest = resolve(process.env.INIT_CWD ?? process.cwd(), target);
const here = new URL('..', import.meta.url);

// Não sobrescreve o catálogo nem os sistemas já publicados.
await cp(new URL('repo/', here), dest, {
  recursive: true,
  force: false,
  errorOnExist: false,
});
await cp(new URL('repo/.github/', here), resolve(dest, '.github'), {
  recursive: true,
  force: true,
});
await cp(new URL('repo/README.md', here), resolve(dest, 'README.md'), { force: true });
await mkdir(resolve(dest, 'scripts'), { recursive: true });
await cp(new URL('dist/tabula-registry.mjs', here), resolve(dest, 'scripts/tabula-registry.mjs'));
console.log(`Repositório da comunidade atualizado em ${dest}`);
