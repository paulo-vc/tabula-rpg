import type { SystemTemplate } from '@tabula/domain';
import { TabulaDatabase } from '@tabula/storage';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { createServices, type Services } from './app/services';
import { MemoryRegistrySource, nodeSha256 } from './testing/memory-registry';

let db: TabulaDatabase;
let registry: MemoryRegistrySource;
let services: Services;

beforeEach(() => {
  window.location.hash = '';
  db = new TabulaDatabase(`ui-${crypto.randomUUID()}`);
  registry = new MemoryRegistrySource();
  services = createServices(db, {
    registrySource: registry,
    sha256: nodeSha256,
    appVersion: '0.1.0',
  });
});

afterEach(async () => {
  cleanup();
  db.close();
  await db.delete();
});

const system = (id: string, name: string, version = '1.0.0'): SystemTemplate => ({
  id,
  version,
  name,
  author: 'Maria',
  license: 'CC-BY-4.0',
  source: 'community',
  fields: [{ id: 'vigor', key: 'vigor', label: 'Vigor', type: 'number' }],
  layouts: { full: [] },
});

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App services={services} />);
  return user;
}

const cardOf = async (name: string) =>
  (await screen.findByText(name, { selector: '[data-slot="card-title"]' })).closest(
    '[data-slot="card"]',
  ) as HTMLElement;

describe('sistemas da comunidade', () => {
  it('busca e instala um sistema do catálogo', async () => {
    registry.publish(system('ordem', 'Ordem Paranormal')).publish(system('mesa', 'Mesa Rápida'));
    const user = renderAt('#/sistemas/comunidade');

    expect(await cardOf('Mesa Rápida')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Buscar sistemas' }), 'ordem');
    expect(screen.queryByText('Mesa Rápida')).not.toBeInTheDocument();

    const card = await cardOf('Ordem Paranormal');
    await user.click(within(card).getByRole('button', { name: 'Instalar' }));
    expect(await within(card).findByText('Instalado')).toBeInTheDocument();
    expect(await services.catalog.get('ordem')).toMatchObject({ source: 'community' });
  });

  it('avisa da atualização na lista de sistemas e atualiza pela comunidade', async () => {
    registry.publish(system('ordem', 'Ordem Paranormal'));
    const [entry] = (await services.registry.loadIndex()).templates;
    if (entry) await services.registry.install(entry);
    registry.publish(system('ordem', 'Ordem Paranormal', '1.1.0'));

    const user = renderAt('#/sistemas');
    await user.click(await screen.findByRole('link', { name: 'Versão 1.1.0' }));

    const card = await cardOf('Ordem Paranormal');
    await user.click(within(card).getByRole('button', { name: 'Atualizar de 1.0.0 para 1.1.0' }));
    expect(await within(card).findByText('Instalado')).toBeInTheDocument();
    expect((await services.catalog.get('ordem'))?.version).toBe('1.1.0');
  });

  it('sem internet, explica e permite tentar de novo', async () => {
    registry.publish(system('ordem', 'Ordem Paranormal'));
    registry.offline = true;
    const user = renderAt('#/sistemas/comunidade');

    expect(await screen.findByText(/Verifique a internet/)).toBeInTheDocument();
    registry.offline = false;
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await cardOf('Ordem Paranormal')).toBeInTheDocument();
  });

  it('sistemas criados no aparelho oferecem publicação', async () => {
    await services.files.installTemplate({ ...system('caseiro', 'Meu Sistema'), source: 'local' });
    const user = renderAt('#/sistemas');

    const card = await cardOf('Meu Sistema');
    await user.click(within(card).getByRole('button', { name: 'Publicar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/conta no GitHub/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Baixar e abrir o GitHub' })).toBeEnabled();

    // O sistema nativo não pode ser publicado por aqui.
    const builtin = await cardOf('D&D 5ª Edição (SRD 5.1)');
    expect(within(builtin).queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument();
  });
});
