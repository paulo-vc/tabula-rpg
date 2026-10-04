import { FORMAT_VERSION } from '@tabula/domain';

export function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-zinc-950 text-zinc-100">
      <h1 className="text-4xl font-bold tracking-tight">Tabula RPG</h1>
      <p className="text-zinc-400">Fundação do projeto — formato v{FORMAT_VERSION}</p>
    </main>
  );
}
