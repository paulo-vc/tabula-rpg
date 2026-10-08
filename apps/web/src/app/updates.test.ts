import { describe, expect, it } from 'vitest';
import { checkForUpdate } from './updates';

const release = (tag: string, draft = false) => ({
  tag_name: tag,
  html_url: `https://github.com/paulo-vc/tabula-rpg/releases/tag/${tag}`,
  draft,
});

describe('checkForUpdate', () => {
  it('avisa da versão publicada mais nova', async () => {
    const update = await checkForUpdate('0.1.0', async () => [
      release('v0.1.0'),
      release('v0.3.0', true), // rascunho: ainda não publicada
      release('v0.2.1'),
      release('v0.2.0'),
    ]);
    expect(update).toEqual({
      version: '0.2.1',
      url: 'https://github.com/paulo-vc/tabula-rpg/releases/tag/v0.2.1',
    });
  });

  it('não avisa se já está na mais nova (ou numa mais nova ainda)', async () => {
    const load = async () => [release('v0.1.0')];
    expect(await checkForUpdate('0.1.0', load)).toBeNull();
    expect(await checkForUpdate('0.2.0', load)).toBeNull();
  });

  it('ignora sem internet, resposta estranha e endereços fora do GitHub', async () => {
    expect(
      await checkForUpdate('0.1.0', async () => {
        throw new Error('offline');
      }),
    ).toBeNull();
    expect(await checkForUpdate('0.1.0', async () => ({ message: 'rate limit' }))).toBeNull();
    expect(
      await checkForUpdate('0.1.0', async () => [
        { tag_name: 'v9.0.0', html_url: 'https://golpe.example/tabula.exe', draft: false },
        release('versao-estranha'),
      ]),
    ).toBeNull();
  });
});
