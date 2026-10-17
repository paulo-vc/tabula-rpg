import type { SystemTemplate } from '@tabula/domain';
import { TabulaDatabase } from '@tabula/storage';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { createServices, type Services } from './app/services';

let db: TabulaDatabase;
let services: Services;

beforeEach(() => {
  window.location.hash = '';
  db = new TabulaDatabase(`ui-ataque-${crypto.randomUUID()}`);
  // Dados previsíveis: sempre 4.
  services = createServices(db, { dieRoller: () => 4 });
});

afterEach(async () => {
  cleanup();
  db.close();
  await db.delete();
});

const TEMPLATE: SystemTemplate = {
  id: 'combate',
  version: '1.0.0',
  name: 'Sistema de Combate',
  source: 'local',
  checkDice: '1d20',
  fields: [
    {
      id: 'ataques',
      key: 'ataques',
      label: 'Ataques',
      type: 'list',
      attack: { bonus: 'bonus', damage: 'dano' },
      itemFields: [
        { id: 'nome', key: 'nome', label: 'Nome', type: 'text' },
        { id: 'bonus', key: 'bonus', label: 'Bônus de ataque', type: 'number', default: 0 },
        { id: 'dano', key: 'dano', label: 'Dano', type: 'dice' },
      ],
    },
  ],
  layouts: { full: [{ kind: 'field', fieldId: 'ataques' }] },
};

async function openSheet() {
  await services.files.installTemplate(TEMPLATE);
  const sheet = await services.sheets.create({ name: 'Lia', templateId: 'combate' });
  await services.sheets.setValue(sheet.id, 'ataques', [
    { id: 'a1', values: { nome: 'Espada longa', bonus: 5, dano: '1d8+3' } },
    { id: 'a2', values: { nome: 'Soco', bonus: 2 } },
  ]);
  window.location.hash = `#/fichas/${sheet.id}`;
  const user = userEvent.setup();
  render(<App services={services} />);
  return user;
}

describe('ataques pela ficha', () => {
  it('"Ataque" rola o dado do sistema com o bônus', async () => {
    const user = await openSheet();
    await user.click(await screen.findByRole('button', { name: 'Atacar com Espada longa' }));
    // 1d20 (4) + 5.
    expect(await screen.findByText('Espada longa: ataque 9')).toBeInTheDocument();
  });

  it('"Ataque + dano" rola os dois num aviso só', async () => {
    const user = await openSheet();
    await user.click(
      await screen.findByRole('button', { name: 'Atacar com Espada longa e rolar o dano' }),
    );
    // Ataque 4 + 5; dano 1d8 (4) + 3.
    expect(await screen.findByText('Espada longa: ataque 9 · dano 7')).toBeInTheDocument();
    expect(screen.getByText('1d20 + 5 → [4] + 5 = 9 | 1d8 + 3 → [4] + 3 = 7')).toBeInTheDocument();
  });

  it('sem dano preenchido, o item só tem "Ataque"', async () => {
    await openSheet();
    expect(await screen.findByRole('button', { name: 'Atacar com Soco' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Atacar com Soco e rolar o dano' }),
    ).not.toBeInTheDocument();
  });
});
