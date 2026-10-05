import {
  CampaignInviteSchema,
  err,
  ok,
  type CampaignInvite,
  type Issue,
  type Result,
} from '@tabula/domain';

/** Rota do convite dentro do app (rotas com hash: tudo fica no fragmento da URL). */
export const INVITE_ROUTE = '/convite/';

/** Convites são pequenos; limite generoso contra textos colados degenerados. */
const MAX_INVITE_LENGTH = 4096;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Segredo de campanha: 128 bits aleatórios em base64url (22 caracteres). */
export function randomSecret(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

/** Código do convite: o convite em JSON, codificado em base64url (seguro em URLs). */
export function encodeInvite(invite: CampaignInvite): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(invite)));
}

/**
 * Link de convite. Com rotas por hash, todo o convite (inclusive o segredo) fica depois do
 * `#`, que os navegadores nunca enviam ao servidor que hospeda o app.
 * @param baseUrl endereço público do app, ex.: "https://exemplo.github.io/tabula/".
 */
export function inviteUrl(invite: CampaignInvite, baseUrl: string): string {
  const base = baseUrl.split('#')[0] as string;
  return `${base}#${INVITE_ROUTE}${encodeInvite(invite)}`;
}

const invalid = (message: string): Result<CampaignInvite, Issue> =>
  err({ code: 'convite-invalido', path: [], message });

/** Lê um convite colado pelo usuário: o link completo ou só o código. */
export function decodeInvite(input: string): Result<CampaignInvite, Issue> {
  const text = input.trim();
  if (text.length === 0) return invalid('Cole o link ou o código do convite.');
  if (text.length > MAX_INVITE_LENGTH) return invalid('Convite inválido.');

  const marker = text.indexOf(INVITE_ROUTE);
  const code = marker >= 0 ? text.slice(marker + INVITE_ROUTE.length) : text;
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return invalid('Convite inválido ou incompleto.');

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(code)));
  } catch {
    return invalid('Convite inválido ou incompleto.');
  }
  const parsed = CampaignInviteSchema.safeParse(json);
  if (!parsed.success) {
    const version = (json as { v?: unknown } | null)?.v;
    if (typeof version === 'number' && version > 1) {
      return invalid('Este convite foi criado por uma versão mais nova do Tabula. Atualize o app.');
    }
    return invalid('Convite inválido ou incompleto.');
  }
  return ok(parsed.data);
}
