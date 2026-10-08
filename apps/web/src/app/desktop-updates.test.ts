import { describe, expect, it } from 'vitest';
import { findUpdate, type PendingUpdate, type Updater } from './desktop-updates';

const pending: PendingUpdate = { version: '0.2.0', install: async () => {} };
const manualOffer = {
  version: '0.2.0',
  url: 'https://github.com/paulo-vc/tabula-rpg/releases/tag/v0.2.0',
};

const updater = (check: Updater['check']): Updater => ({ check, relaunch: async () => {} });

describe('findUpdate', () => {
  it('prefere a atualização automática', async () => {
    const offer = await findUpdate(
      updater(async () => pending),
      '0.1.0',
      async () => manualOffer,
    );
    expect(offer).toEqual({ kind: 'automatica', update: pending });
  });

  it('se o atualizador diz que está em dia, não consulta mais nada', async () => {
    let consulted = false;
    const offer = await findUpdate(
      updater(async () => null),
      '0.2.0',
      async () => {
        consulted = true;
        return manualOffer;
      },
    );
    expect(offer).toBeNull();
    expect(consulted).toBe(false);
  });

  it('se o atualizador falha, avisa pelo catálogo de releases', async () => {
    const offer = await findUpdate(
      updater(async () => {
        throw new Error('latest.json não encontrado');
      }),
      '0.1.0',
      async () => manualOffer,
    );
    expect(offer).toEqual({ kind: 'manual', update: manualOffer });
  });

  it('sem atualizador (versões antigas) e sem versão nova: nada a oferecer', async () => {
    expect(await findUpdate(null, '0.2.0', async () => null)).toBeNull();
    expect(await findUpdate(null, '0.1.0', async () => manualOffer)).toEqual({
      kind: 'manual',
      update: manualOffer,
    });
  });
});
