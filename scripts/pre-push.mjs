// Hook de pre-push (instalado pelo `pnpm install` via simple-git-hooks). Ver docs/adr/0007-fluxo-git.md.
//
// 1. Recusa push direto para a branch protegida: mudanças entram apenas por Pull Request.
// 2. Roda `pnpm check` para que código quebrado não chegue ao GitHub.
//
// Emergência: `git push --no-verify` pula este hook.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PROTECTED_REFS = ['refs/heads/main'];

// O Git envia uma linha por ref: "<ref local> <sha local> <ref remota> <sha remota>".
const updates = readFileSync(0, 'utf8')
  .split('\n')
  .map((line) => line.trim().split(' '))
  .filter((fields) => fields.length === 4);

const blocked = updates.filter(([, , remoteRef]) => PROTECTED_REFS.includes(remoteRef));
if (blocked.length > 0) {
  console.error(
    '\n✖ Push direto para a main não é permitido.\n' +
      '  Crie uma branch (ex.: git switch -c feat/minha-mudanca) e abra um Pull Request.\n',
  );
  process.exit(1);
}

if (updates.length === 0) process.exit(0);

console.log('▶ Rodando `pnpm check` antes do push…');
const result = spawnSync('pnpm', ['check'], { stdio: 'inherit', shell: true });
if (result.status !== 0) {
  console.error('\n✖ `pnpm check` falhou. Corrija os erros antes de enviar.\n');
}
process.exit(result.status ?? 1);
