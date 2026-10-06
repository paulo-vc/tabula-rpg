import 'fake-indexeddb/auto';
import { inviteFor } from '@tabula/domain';
import { TabulaDatabase } from '@tabula/storage';
import { MemoryNetwork } from '@tabula/sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServices, type Services } from '@/app/services';
import { keepSessionAcrossReloads } from './session-resume';

let network: MemoryNetwork;
let db: TabulaDatabase;
let storage: Storage;

/** Simula recarregar a aba: serviços novos sobre o mesmo banco e o mesmo sessionStorage. */
const reload = (): Services => createServices(db, { createTransport: () => network.join() });

beforeEach(() => {
  network = new MemoryNetwork();
  db = new TabulaDatabase(`retomar-${crypto.randomUUID()}`);
  const data = new Map<string, string>();
  storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  };
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('retomar a sessão após recarregar', () => {
  it('o Mestre volta para a sessão aberta', async () => {
    const first = reload();
    keepSessionAcrossReloads(first.session, storage);
    const campaign = await first.campaigns.create({
      name: 'Mesa',
      templateId: 'dnd5e-srd',
      gmName: 'Paulo',
    });
    await first.session.startAsGameMaster(campaign.id);

    const second = reload(); // F5
    keepSessionAcrossReloads(second.session, storage);
    await vi.waitFor(() =>
      expect(second.session.getSnapshot()).toMatchObject({
        kind: 'mestre',
        campaignId: campaign.id,
      }),
    );
    await second.session.stop();
  });

  it('a jogadora volta para a sessão com a ficha vinculada', async () => {
    const gm = createServices(new TabulaDatabase(`retomar-mestre-${crypto.randomUUID()}`));
    const campaign = await gm.campaigns.create({
      name: 'Mesa',
      templateId: 'dnd5e-srd',
      gmName: 'Paulo',
    });
    const first = reload();
    keepSessionAcrossReloads(first.session, storage);
    await first.campaigns.join(inviteFor(campaign), 'Ana');
    await first.campaigns.createLinkedSheet(campaign.id, 'Lia');
    await first.session.joinAsPlayer(campaign.id);

    const second = reload();
    keepSessionAcrossReloads(second.session, storage);
    await vi.waitFor(() => expect(second.session.getSnapshot()).toMatchObject({ kind: 'jogador' }));
    await second.session.stop();
  });

  it('sair da sessão antes de recarregar não retoma', async () => {
    const first = reload();
    keepSessionAcrossReloads(first.session, storage);
    const campaign = await first.campaigns.create({
      name: 'Mesa',
      templateId: 'dnd5e-srd',
      gmName: 'Paulo',
    });
    await first.session.startAsGameMaster(campaign.id);
    await first.session.stop();

    const second = reload();
    keepSessionAcrossReloads(second.session, storage);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(second.session.getSnapshot()).toEqual({ kind: 'nenhuma' });
  });

  it('campanha apagada: esquece a sessão em vez de tentar para sempre', async () => {
    storage.setItem(
      'tabula:sessao-ativa',
      JSON.stringify({ kind: 'mestre', campaignId: 'apagada' }),
    );
    const services = reload();
    keepSessionAcrossReloads(services.session, storage);
    await vi.waitFor(() => expect(storage.getItem('tabula:sessao-ativa')).toBeNull());
  });

  it('ignora conteúdo inválido no armazenamento', () => {
    storage.setItem('tabula:sessao-ativa', '{lixo');
    const services = reload();
    expect(() => keepSessionAcrossReloads(services.session, storage)).not.toThrow();
    expect(services.session.getSnapshot()).toEqual({ kind: 'nenhuma' });
  });
});
