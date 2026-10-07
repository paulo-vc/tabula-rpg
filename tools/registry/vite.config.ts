import { defineConfig } from 'vitest/config';

/**
 * Empacota a CLI num único `.mjs` sem dependências: o repositório da comunidade só
 * precisa do Node para rodá-la, sem instalar pacotes.
 */
export default defineConfig({
  build: {
    ssr: 'src/cli.ts',
    target: 'node24',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { entryFileNames: 'tabula-registry.mjs' } },
  },
  ssr: { noExternal: true },
  test: { environment: 'node' },
});
