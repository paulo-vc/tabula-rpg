import { defineConfig, devices } from '@playwright/test';

const RELAY_PORT = 4510;
const APP_PORT = 4174;

/**
 * Testes de ponta a ponta: o app de verdade (build de produção), com Mestre e jogadores em
 * contextos de navegador separados (cada um com o próprio banco, como aparelhos
 * diferentes). A rede é um relay local em vez de WebRTC + relays públicos (ver
 * `relay-server.ts`); o WebRTC em si tem a ferramenta `tools/conn-test`.
 */
export default defineConfig({
  testDir: './tests',
  // Cada teste abre vários contextos e uma sessão ao vivo: folga para máquinas lentas.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${APP_PORT}/`,
    locale: 'pt-BR',
    // O service worker do PWA não deve servir uma versão antiga entre execuções.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node relay-server.ts',
      port: RELAY_PORT,
      env: { E2E_RELAY_PORT: String(RELAY_PORT) },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm --filter @tabula/web exec vite build --outDir dist-e2e && pnpm --filter @tabula/web exec vite preview --outDir dist-e2e --port ${APP_PORT} --strictPort`,
      port: APP_PORT,
      env: { VITE_E2E_RELAY: `ws://localhost:${RELAY_PORT}` },
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
