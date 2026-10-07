import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { serializeIndex, type Issue } from '@tabula/domain';
import { BUILTIN_TEMPLATES } from '@tabula/templates';
import { ingest, report } from './ingest';
import { applyWrites, buildIndex, readRepo } from './repo';

/**
 * CLI usada pelos workflows do repositório da comunidade. Roda na raiz do repositório.
 *
 *   ingest <relatorio.md>   lê a issue do evento, grava os arquivos e escreve o relatório
 *   index                   regenera o index.json
 *   check                   verifica todos os arquivos (pedidos de inclusão feitos à mão)
 */

/**
 * Baixa um anexo da issue. O endereço já foi conferido (`github.com/user-attachments`);
 * o GitHub redireciona para o armazenamento dele. Anexos são limitados a 25 MB pelo GitHub.
 */
async function download(url: string, maxBytes: number): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error('Arquivo grande demais');
  return new TextDecoder().decode(bytes);
}

async function setOutputs(outputs: Record<string, string>): Promise<void> {
  const file = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`);
  if (file) await appendFile(file, lines.join(''));
  else process.stdout.write(lines.join(''));
}

const printIssues = (issues: Issue[]) => {
  for (const issue of issues) console.error(`- ${issue.path.join('.')}: ${issue.message}`);
};

async function main(): Promise<number> {
  const [command, arg] = process.argv.slice(2);
  const root = process.cwd();

  switch (command) {
    case 'ingest': {
      const eventPath = process.env.GITHUB_EVENT_PATH;
      if (!eventPath || !arg) throw new Error('Uso: ingest <relatorio.md> (com GITHUB_EVENT_PATH)');
      const event = JSON.parse(await readFile(eventPath, 'utf-8')) as {
        issue: { body: string | null; user: { login: string } };
      };
      const result = await ingest({
        body: event.issue.body ?? '',
        submitter: event.issue.user.login,
        now: new Date().toISOString(),
        repo: await readRepo(root),
        builtinIds: BUILTIN_TEMPLATES.map((template) => template.id),
        download,
      });
      await writeFile(arg, report(result));
      if (result.ok) {
        await applyWrites(root, result.value.writes);
        const { id, version } = result.value.template;
        await setOutputs({ ok: 'true', id, version });
      } else {
        printIssues(result.error);
        await setOutputs({ ok: 'false' });
      }
      return 0;
    }
    case 'index':
    case 'check': {
      const index = buildIndex(await readRepo(root));
      if (!index.ok) {
        console.error('Repositório com problemas:');
        printIssues(index.error);
        return 1;
      }
      if (command === 'index') await writeFile('index.json', serializeIndex(index.value));
      console.log(`${index.value.templates.length} sistema(s) verificados.`);
      return 0;
    }
    default:
      console.error('Comandos: ingest <relatorio.md> | index | check');
      return 2;
  }
}

process.exitCode = await main();
