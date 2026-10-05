import './style.css';
import { CONNECTION_LABEL } from './connection';
import { diagnoseNetwork } from './gather';
import { NAT_DESCRIPTION, type NatDiagnosis } from './nat';
import { formatReport, newRoomCode, normalizeRoomCode, type PeerResult } from './report';
import { joinTestRoom, type PeerState } from './room';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const nameInput = $<HTMLInputElement>('name');
const networkSelect = $<HTMLSelectElement>('network');
const codeInput = $<HTMLInputElement>('code');

const state: {
  nat: NatDiagnosis | null;
  roomCode: string | null;
  peers: ReadonlyMap<string, PeerState>;
  failures: number;
  leave: (() => Promise<void>) | null;
} = { nat: null, roomCode: null, peers: new Map(), failures: 0, leave: null };

// Lembra nome e rede entre aberturas da página (só neste navegador).
const remember = (key: string, element: HTMLInputElement | HTMLSelectElement) => {
  try {
    element.value = localStorage.getItem(key) ?? '';
    element.addEventListener('change', () => localStorage.setItem(key, element.value));
  } catch {
    // armazenamento indisponível (ex.: aberto como arquivo em modo privado)
  }
};
remember('teste-conexao:nome', nameInput);
remember('teste-conexao:rede', networkSelect);

function renderReport() {
  const peers: PeerResult[] = [...state.peers.values()].map((peer) => ({
    name: peer.name,
    outcome: { ok: true, seconds: peer.seconds, connection: peer.connection },
  }));
  $('report').textContent = formatReport({
    name: nameInput.value.trim(),
    network: networkSelect.value,
    nat: state.nat,
    roomCode: state.roomCode,
    peers,
    failures: state.failures,
    userAgent: navigator.userAgent,
  });
}

function renderPeers() {
  const list = $('peers');
  list.replaceChildren(
    ...[...state.peers.values()].map((peer) => {
      const item = document.createElement('li');
      const c = peer.connection;
      const detail = c
        ? `${CONNECTION_LABEL[c.kind]}${c.ipVersion ? ` · IPv${c.ipVersion}` : ''}${c.rttMs !== null ? ` · ${c.rttMs} ms` : ''}`
        : 'conectado (medindo…)';
      item.className = 'ok';
      item.textContent = `✔ ${peer.name}: ${detail}${peer.status === 'saiu' ? ' (saiu)' : ''}`;
      return item;
    }),
  );
  if (state.failures > 0) {
    const item = document.createElement('li');
    item.className = 'fail';
    item.textContent = `✖ ${state.failures} conexão(ões) direta(s) falharam — precisariam de relay`;
    list.append(item);
  }
  const connected = [...state.peers.values()].filter((p) => p.status === 'conectado').length;
  $('room-status').textContent =
    connected > 0 ? `${connected} conectado(s)` : 'procurando participantes…';
  renderReport();
}

function enterRoom(code: string) {
  state.roomCode = code;
  state.peers = new Map();
  state.failures = 0;
  const room = joinTestRoom(code, nameInput.value.trim() || 'sem nome', {
    onPeersChange: (peers) => {
      state.peers = peers;
      renderPeers();
    },
    onDirectFailure: (failures) => {
      state.failures = failures;
      renderPeers();
    },
  });
  state.leave = room.leave;
  $('room-code').textContent = code;
  $('room').hidden = false;
  $<HTMLButtonElement>('create').disabled = true;
  $<HTMLButtonElement>('join').disabled = true;
  renderPeers();
}

$('create').addEventListener('click', () => {
  const code = newRoomCode();
  codeInput.value = code;
  enterRoom(code);
});

$('join').addEventListener('click', () => {
  const code = normalizeRoomCode(codeInput.value);
  if (!code) {
    codeInput.setCustomValidity('Código inválido: 8 letras/números, ex.: K7QM-XR4P');
    codeInput.reportValidity();
    return;
  }
  codeInput.setCustomValidity('');
  enterRoom(code);
});

$('leave').addEventListener('click', async () => {
  await state.leave?.();
  state.leave = null;
  $('room').hidden = true;
  $<HTMLButtonElement>('create').disabled = false;
  $<HTMLButtonElement>('join').disabled = false;
  renderReport();
});

$('copy').addEventListener('click', async () => {
  renderReport();
  await navigator.clipboard.writeText($('report').textContent ?? '');
  $('copied').hidden = false;
  setTimeout(() => ($('copied').hidden = true), 3000);
});

nameInput.addEventListener('input', renderReport);
networkSelect.addEventListener('change', renderReport);

diagnoseNetwork().then(
  (nat) => {
    state.nat = nat;
    $('nat-status').textContent =
      `${NAT_DESCRIPTION[nat.natType]} IPv6 público: ${nat.ipv6 ? 'sim' : 'não'}.`;
    $('nat-status').className = nat.natType === 'cone' || nat.natType === 'aberto' ? 'ok' : 'fail';
    renderReport();
  },
  (error: unknown) => {
    $('nat-status').textContent = `Não foi possível analisar a rede: ${String(error)}`;
  },
);

renderReport();
