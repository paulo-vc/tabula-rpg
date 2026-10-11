import type { CampaignInvite } from '@tabula/domain';

/**
 * Formato compacto do convite (binário, depois em base64url). O JSON da v0.1/v0.2 tinha
 * ~460 caracteres; este, ~190. O conteúdo é o mesmo `CampaignInvite`: IDs no formato UUID
 * viram 16 bytes, o segredo e a chave do Mestre vão em bytes crus, e os textos levam o
 * tamanho na frente.
 *
 *   [2] [flags] campanha Mestre segredo(16) chave?(32) origem sistema versão nome mestre nomeSistema
 *
 * Quem decodifica valida o resultado com `CampaignInviteSchema`, como no formato antigo.
 */
export const COMPACT_FORMAT = 2;

const Flag = { GmKey: 1, CampaignUuid: 2, GmUuid: 4, ShortVersion: 8 } as const;

const SOURCES = ['builtin', 'community', 'local'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function base64UrlBytes(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

class Writer {
  private readonly bytes: number[] = [];
  byte(value: number) {
    this.bytes.push(value & 0xff);
  }
  raw(bytes: Uint8Array) {
    for (const byte of bytes) this.bytes.push(byte);
  }
  /** Tamanho (LEB128) seguido do texto em UTF-8. */
  text(value: string) {
    const encoded = new TextEncoder().encode(value);
    let length = encoded.length;
    do {
      this.byte((length & 0x7f) | (length > 0x7f ? 0x80 : 0));
      length >>>= 7;
    } while (length > 0);
    this.raw(encoded);
  }
  uuid(value: string) {
    const hex = value.replace(/-/g, '');
    for (let i = 0; i < 32; i += 2) this.byte(parseInt(hex.slice(i, i + 2), 16));
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  byte(): number {
    const value = this.bytes[this.offset++];
    if (value === undefined) throw new Error('fim inesperado');
    return value;
  }
  raw(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new Error('fim inesperado');
    const slice = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
  text(): string {
    let length = 0;
    for (let shift = 0; ; shift += 7) {
      if (shift > 21) throw new Error('tamanho inválido');
      const byte = this.byte();
      length |= (byte & 0x7f) << shift;
      if (byte < 0x80) break;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(this.raw(length));
  }
  uuid(): string {
    const hex = [...this.raw(16)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  end() {
    if (this.offset !== this.bytes.length) throw new Error('bytes sobrando');
  }
}

const shortVersion = (version: string): number[] | null => {
  const parts = version.split('.').map(Number);
  return parts.length === 3 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? parts
    : null;
};

/** Convite → bytes compactos. */
export function packInvite(invite: CampaignInvite): Uint8Array {
  const version = shortVersion(invite.templateRef.version);
  const flags =
    (invite.gmKey !== undefined ? Flag.GmKey : 0) |
    (UUID.test(invite.campaignId) ? Flag.CampaignUuid : 0) |
    (UUID.test(invite.gmId) ? Flag.GmUuid : 0) |
    (version ? Flag.ShortVersion : 0);
  const out = new Writer();
  out.byte(COMPACT_FORMAT);
  out.byte(flags);
  if (flags & Flag.CampaignUuid) out.uuid(invite.campaignId);
  else out.text(invite.campaignId);
  if (flags & Flag.GmUuid) out.uuid(invite.gmId);
  else out.text(invite.gmId);
  out.raw(base64UrlBytes(invite.secret));
  if (invite.gmKey !== undefined) out.raw(base64UrlBytes(invite.gmKey));
  out.byte(SOURCES.indexOf(invite.templateRef.source));
  out.text(invite.templateRef.id);
  if (version) version.forEach((n) => out.byte(n));
  else out.text(invite.templateRef.version);
  out.text(invite.name);
  out.text(invite.gmName);
  out.text(invite.templateName);
  return out.done();
}

/**
 * Bytes compactos → convite, ainda NÃO validado (quem chama passa pelo schema).
 * Lança erro se os bytes estiverem truncados ou malformados.
 */
export function unpackInvite(bytes: Uint8Array): unknown {
  const input = new Reader(bytes);
  if (input.byte() !== COMPACT_FORMAT) throw new Error('formato desconhecido');
  const flags = input.byte();
  const campaignId = flags & Flag.CampaignUuid ? input.uuid() : input.text();
  const gmId = flags & Flag.GmUuid ? input.uuid() : input.text();
  const secret = bytesBase64Url(input.raw(16));
  const gmKey = flags & Flag.GmKey ? bytesBase64Url(input.raw(32)) : undefined;
  const source = SOURCES[input.byte()];
  const templateId = input.text();
  const version =
    flags & Flag.ShortVersion ? `${input.byte()}.${input.byte()}.${input.byte()}` : input.text();
  const name = input.text();
  const gmName = input.text();
  const templateName = input.text();
  input.end();
  return {
    v: 1,
    campaignId,
    name,
    gmId,
    gmName,
    ...(gmKey !== undefined && { gmKey }),
    templateRef: { id: templateId, version, source },
    templateName,
    secret,
  };
}
