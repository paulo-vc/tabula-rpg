import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

// O app desktop (Tauri) carrega este mesmo frontend. Porta fixa para o `devUrl` do Tauri.
export default defineConfig({
  // Caminhos relativos: o mesmo build funciona no GitHub Pages (subpasta) e no app desktop.
  base: './',
  // Versão do app: sistemas da comunidade podem exigir uma versão mínima.
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // No app desktop (Tauri) os arquivos já são locais: service worker é desnecessário.
      disable: Boolean(process.env.TAURI_ENV_PLATFORM),
      manifest: {
        name: 'Tabularium',
        short_name: 'Tabularium',
        description: 'Fichas de RPG de mesa com sessão ao vivo para o Mestre.',
        lang: 'pt-BR',
        theme_color: '#8a3418',
        background_color: '#1c1714',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2023',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
