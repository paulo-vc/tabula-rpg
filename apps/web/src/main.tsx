import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createWebRtcTransport } from '@tabula/sync/webrtc';
import { createServices } from './app/services';
import { keepSessionAcrossReloads } from './lib/session-resume';
import './index.css';

// Tema claro/escuro acompanha o sistema operacional.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', darkQuery.matches);
applyTheme();
darkQuery.addEventListener('change', applyTheme);

const services = createServices(undefined, { createTransport: createWebRtcTransport });
keepSessionAcrossReloads(services.session);
// Guarda o estado da sessão ao vivo se a aba for fechada ou escondida.
window.addEventListener('pagehide', () => void services.session.flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void services.session.flush();
});

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado');

createRoot(root).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>,
);
