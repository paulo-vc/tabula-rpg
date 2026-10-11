import {
  CampaignInviteSchema,
  err,
  ok,
  type CampaignInvite,
  type Issue,
  type Result,
} from '@tabula/domain';
import { COMPACT_FORMAT, packInvite, unpackInvite } from './invite-codec';

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

/**
 * Código do convite em base64url (seguro em URLs). Usa o formato compacto (binário, ~190
 * caracteres); se algum convite incomum não sobreviver à ida e volta, cai no JSON antigo,
 * que todas as versões leem.
 */
export function encodeInvite(invite: CampaignInvite): string {
  try {
    const compact = toBase64Url(packInvite(invite));
    if (sameInvite(unpackInvite(fromBase64Url(compact)), invite)) return compact;
  } catch {
    // formato compacto indisponível para este convite
  }
  return toBase64Url(new TextEncoder().encode(JSON.stringify(invite)));
}

function sameInvite(a: unknown, b: CampaignInvite): boolean {
  const parsed = CampaignInviteSchema.safeParse(a);
  return (
    parsed.success && JSON.stringify(parsed.data) === JSON.stringify(CampaignInviteSchema.parse(b))
  );
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
    const bytes = fromBase64Url(code);
    const format = bytes[0] ?? 0;
    if (format !== 0x7b && format > COMPACT_FORMAT && format < 0x20) {
      return invalid(
        'Este convite foi criado por uma versão mais nova do Tabularium. Atualize o app.',
      );
    }
    // JSON (v0.1/v0.2) começa com "{"; o formato compacto, com o número do formato.
    json =
      bytes[0] === 0x7b
        ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        : unpackInvite(bytes);
  } catch {
    return invalid('Convite inválido ou incompleto.');
  }
  const parsed = CampaignInviteSchema.safeParse(json);
  if (!parsed.success) {
    const version = (json as { v?: unknown } | null)?.v;
    if (typeof version === 'number' && version > 1) {
      return invalid(
        'Este convite foi criado por uma versão mais nova do Tabularium. Atualize o app.',
      );
    }
    return invalid('Convite inválido ou incompleto.');
  }
  return ok(parsed.data);
}
