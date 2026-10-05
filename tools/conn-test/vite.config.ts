import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vitest/config';

// Gera um único `dist/index.html` com tudo embutido: dá para enviar o arquivo pelo chat e
// abrir direto no navegador, sem servidor.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: 'es2022' },
  test: { environment: 'node' },
});
