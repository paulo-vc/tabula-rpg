import { CampaignInviteSchema, type CampaignInvite } from '@tabula/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeInvite, encodeInvite, inviteUrl, randomSecret } from './invite-link';

const key = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const invite = (changes: Partial<CampaignInvite> = {}): CampaignInvite => ({
  v: 1,
  campaignId: crypto.randomUUID(),
  name: 'A Mina Perdida',
  gmId: crypto.randomUUID(),
  gmName: 'Paulo',
  gmKey: key(),
  templateRef: { id: 'dnd5e-srd', version: '1.3.0', source: 'builtin' },
  templateName: 'D&D 5ª Edição (SRD 5.1)',
  secret: randomSecret(),
  ...changes,
});

/** O formato antigo (v0.1/v0.2): JSON em base64url. */
const legacyCode = (value: CampaignInvite) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

describe('convite compacto', () => {
  it('fica com menos da metade do tamanho do formato antigo', () => {
    const value = invite();
    const code = encodeInvite(value);
    expect(code.length).toBeLessThan(200);
    expect(legacyCode(value).length).toBeGreaterThan(440);
    expect(inviteUrl(value, 'https://paulo-vc.github.io/tabularium/').length).toBeLessThan(250);
  });

  it.each([
    ['com chave do Mestre', invite()],
    ['sem chave (campanha da v0.1)', (({ gmKey: _k, ...rest }) => rest)(invite())],
    ['IDs que não são UUID', invite({ campaignId: 'campanha_antiga-1', gmId: 'mestre' })],
    ['versão grande', invite({ templateRef: { id: 'meu', version: '300.12.4', source: 'local' } })],
    ['nomes com acento e emoji', invite({ name: 'Crônicas 🐉 de Ébano', gmName: 'Zoë' })],
    [
      'sistema da comunidade',
      invite({ templateRef: { id: 'dualidade', version: '1.2.0', source: 'community' } }),
    ],
  ])('ida e volta sem perder nada: %s', (_, value) => {
    expect(decodeInvite(encodeInvite(value))).toEqual({ ok: true, value });
  });

  it('convites no formato antigo (v0.1/v0.2) continuam valendo', () => {
    const value = invite();
    expect(decodeInvite(legacyCode(value))).toEqual({ ok: true, value });
    expect(decodeInvite(`https://x.dev/#/convite/${legacyCode(value)}`)).toEqual({
      ok: true,
      value,
    });
  });

  it('cortado, com bytes sobrando ou de um formato futuro: mensagem clara', () => {
    const code = encodeInvite(invite());
    expect(decodeInvite(code.slice(0, -10))).toMatchObject({ ok: false });
    expect(decodeInvite(`${code}AAAA`)).toMatchObject({ ok: false });
    const future = `Aw${code.slice(2)}`; // primeiro byte = 3
    expect(decodeInvite(future)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('versão mais nova') },
    });
  });

  it('bytes aleatórios nunca quebram a leitura nem viram convite inválido aceito', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 300 }), (bytes) => {
        const code = btoa(String.fromCharCode(...bytes))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        const result = decodeInvite(code);
        if (result.ok) expect(CampaignInviteSchema.safeParse(result.value).success).toBe(true);
      }),
    );
  });
});
