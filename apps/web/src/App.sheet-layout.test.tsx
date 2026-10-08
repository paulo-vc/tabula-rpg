import { TabulaDatabase } from '@tabula/storage';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { createServices, type Services } from './app/services';
import { applyToResource } from './components/sheet/SheetVitals';
import { groupTabs } from './components/sheet/SheetLayout';

let db: TabulaDatabase;
let services: Services;

beforeEach(() => {
  window.location.hash = '';
  db = new TabulaDatabase(`ui-ficha-${crypto.randomUUID()}`);
  services = createServices(db, { dieRoller: () => 10 });
});

afterEach(async () => {
  cleanup();
  db.close();
  await db.delete();
});

async function openSheet(templateId = 'dnd5e-srd') {
  const sheet = await services.sheets.create({ name: 'Thorin', templateId });
  window.location.hash = `#/fichas/${sheet.id}`;
  const user = userEvent.setup();
  render(<App services={services} />);
  await screen.findByRole('textbox', { name: 'Nome da ficha' });
  return { user, sheet };
}

const stored = async (sheetId: string, fieldId: string) =>
  (await db.sheets.get(sheetId))?.values[fieldId];

describe('painel fixo do personagem', () => {
  it('mostra PV, CA e iniciativa; dano e cura em um toque', async () => {
    const { user, sheet } = await openSheet();
    const vitals = screen.getByRole('region', { name: 'Resumo do personagem' });
    expect(
      within(vitals).getByRole('meter', { name: 'Pontos de Vida: 10 de 10' }),
    ).toBeInTheDocument();
    expect(within(vitals).getByText('Classe de Armadura')).toBeInTheDocument();

    const amount = within(vitals).getByLabelText('Quanto de Pontos de Vida');
    await user.type(amount, '4');
    await user.click(within(vitals).getByRole('button', { name: 'Dano' }));
    await waitFor(async () => expect(await stored(sheet.id, 'hp')).toMatchObject({ current: 6 }));
    expect(amount).toHaveValue('');

    // Cura não passa do máximo.
    await user.type(amount, '9');
    await user.click(within(vitals).getByRole('button', { name: 'Cura' }));
    await waitFor(async () => expect(await stored(sheet.id, 'hp')).toMatchObject({ current: 10 }));
  });

  it('dano tira primeiro dos pontos temporários', () => {
    expect(applyToResource({ current: 10, max: 20, temp: 3 }, 5, 'dano', 20)).toEqual({
      current: 8,
      max: 20,
      temp: 0,
    });
    expect(applyToResource({ current: 10 }, 15, 'cura', 12)).toEqual({ current: 12 });
    expect(applyToResource({ current: 3 }, 5, 'dano', undefined)).toEqual({ current: -2 });
  });
});

describe('abas', () => {
  it('a ficha abre na aba principal; as outras partes ficam a um clique', async () => {
    const { user } = await openSheet();
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual([
      'Principal',
      'Combate',
      'Magias',
      'Inventário',
      'Personagem',
      'Anotações',
    ]);
    expect(screen.getByRole('tab', { name: 'Principal' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('group', { name: 'Equipamento' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Inventário' }));
    expect(screen.getByRole('group', { name: 'Equipamento' })).toBeInTheDocument();
  });

  it('as setas do teclado trocam de aba', async () => {
    const { user } = await openSheet();
    screen.getByRole('tab', { name: 'Principal' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Combate' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Combate' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Anotações' })).toHaveAttribute('aria-selected', 'true');
  });

  it('sistemas sem abas continuam numa página só', () => {
    const section = (title: string, tab?: string) => ({
      kind: 'section' as const,
      title,
      columns: 1 as const,
      children: [],
      ...(tab && { tab }),
    });
    expect(groupTabs([section('A'), section('B')]).map((g) => g.name)).toEqual(['Ficha']);
    const grouped = groupTabs([section('A', 'Um'), section('B'), section('C', 'Dois')]);
    expect(grouped.map((g) => [g.name, g.nodes.length])).toEqual([
      ['Um', 2],
      ['Dois', 1],
    ]);
  });
});

describe('blocos e linhas', () => {
  it('atributo: modificador em destaque, valor pequeno e editável embaixo', async () => {
    const { user, sheet } = await openSheet();
    const strength = screen.getByRole('textbox', { name: 'Força' });
    await user.clear(strength);
    await user.type(strength, '16');
    expect(screen.getByRole('status', { name: 'Mod. Força' })).toHaveTextContent('+3');
    await waitFor(async () => expect(await stored(sheet.id, 'for')).toBe(16));
  });

  it('perícia numa linha: marcar a proficiência soma o bônus', async () => {
    const { user } = await openSheet();
    const proficient = screen.getByRole('checkbox', { name: 'Proficiente em Atletismo' });
    await user.click(proficient);
    expect(proficient).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('status', { name: 'Atletismo (For)' })).toHaveTextContent('+2');
    expect(screen.getByRole('button', { name: 'Rolar Atletismo (For)' })).toBeInTheDocument();
  });

  it('habilidade com descrição longa, que abre por item', async () => {
    const { user, sheet } = await openSheet();
    await user.click(screen.getByRole('tab', { name: 'Personagem' }));
    const abilities = screen.getByRole('group', { name: 'Habilidades e talentos' });
    await user.click(within(abilities).getByRole('button', { name: 'Adicionar' }));
    await user.type(within(abilities).getByLabelText('Habilidade (item 1)'), 'Fúria');

    await user.click(within(abilities).getByRole('button', { name: 'Abrir descrição de Fúria' }));
    await user.type(
      within(abilities).getByLabelText('Descrição de Fúria'),
      'Vantagem em testes de Força.',
    );
    await waitFor(async () => {
      const items = (await stored(sheet.id, 'habilidades')) as { values: object }[];
      expect(items[0]?.values).toMatchObject({
        nome: 'Fúria',
        descricao: 'Vantagem em testes de Força.',
      });
    });
    await user.click(within(abilities).getByRole('button', { name: 'Fechar descrição de Fúria' }));
    expect(within(abilities).queryByLabelText('Descrição de Fúria')).not.toBeInTheDocument();
  });
});
