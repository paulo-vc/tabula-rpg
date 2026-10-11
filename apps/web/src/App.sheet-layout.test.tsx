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
    await user.click(
      within(abilities).getByRole('button', { name: 'Adicionar em Habilidades e talentos' }),
    );
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

describe('ficha sem repetição (IHC)', () => {
  const vitals = () => screen.getByRole('region', { name: 'Resumo do personagem' });
  const outsideVitals = (element: HTMLElement) => !vitals().contains(element);

  it('o que está no painel fixo não se repete nas abas', async () => {
    const { user } = await openSheet();
    await user.click(screen.getByRole('tab', { name: 'Combate' }));
    const panel = screen.getByRole('tabpanel');
    // CA, iniciativa, deslocamento, PV e condições ficam só no painel.
    expect(within(panel).queryByText('Classe de Armadura')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Deslocamento (m)')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('meter', { name: /Pontos de Vida/ })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('group', { name: 'Condições' })).not.toBeInTheDocument();
    // O que não está no painel continua na aba.
    expect(within(panel).getByText('CA base (armadura)')).toBeInTheDocument();
  });

  it('números do painel são editáveis ali mesmo', async () => {
    const { user, sheet } = await openSheet();
    const speed = within(vitals()).getByRole('textbox', { name: 'Deslocamento (m)' });
    await user.clear(speed);
    await user.type(speed, '12');
    await waitFor(async () => expect(await stored(sheet.id, 'deslocamento')).toBe(12));
  });

  it('o número do PV abre o ajuste exato (máximo e temporários)', async () => {
    const { user, sheet } = await openSheet();
    await user.click(within(vitals()).getByRole('button', { name: 'Ajustar Pontos de Vida' }));
    const editor = await screen.findByRole('dialog', { name: 'Ajustar Pontos de Vida' });
    const temp = within(editor).getByLabelText('Temporários');
    await user.clear(temp);
    await user.type(temp, '5');
    const max = within(editor).getByLabelText('Máximo');
    await user.clear(max);
    await user.type(max, '14');
    await user.tab();
    await waitFor(async () =>
      expect(await stored(sheet.id, 'hp')).toMatchObject({ current: 10, max: 14, temp: 5 }),
    );
  });

  it('Inspiração liga e desliga com um toque no painel', async () => {
    const { user, sheet } = await openSheet();
    const inspiration = within(vitals()).getByRole('button', { name: 'Inspiração' });
    expect(inspiration).toHaveAttribute('aria-pressed', 'false');
    await user.click(inspiration);
    expect(inspiration).toHaveAttribute('aria-pressed', 'true');
    await waitFor(async () => expect(await stored(sheet.id, 'inspiracao')).toBe(true));
    expect(screen.getAllByText('Inspiração').filter(outsideVitals)).toHaveLength(0);
  });
});

describe('marcadores', () => {
  it('testes contra a morte são 3 bolinhas: marcar a 2ª marca duas; clicar de novo desmarca', async () => {
    const { user, sheet } = await openSheet();
    await user.click(screen.getByRole('tab', { name: 'Combate' }));
    const saves = screen.getByRole('group', { name: 'Testes contra a morte: sucessos: 0 de 3' });
    const second = within(saves).getByRole('button', {
      name: 'Testes contra a morte: sucessos: 2',
    });

    await user.click(second);
    expect(second).toHaveAttribute('aria-pressed', 'true');
    await waitFor(async () => expect(await stored(sheet.id, 'sucessos_morte')).toBe(2));

    await user.click(second);
    await waitFor(async () => expect(await stored(sheet.id, 'sucessos_morte')).toBe(1));
  });

  it('exaustão (0 a 6) fica no painel como marcadores', async () => {
    const { user, sheet } = await openSheet();
    const vitals = screen.getByRole('region', { name: 'Resumo do personagem' });
    await user.click(within(vitals).getByRole('button', { name: 'Exaustão: 3' }));
    await waitFor(async () => expect(await stored(sheet.id, 'exaustao')).toBe(3));
  });

  it('espaço de magia: digita o máximo e os marcadores aparecem', async () => {
    const { user, sheet } = await openSheet();
    await user.click(screen.getByRole('tab', { name: 'Magias' }));
    const max = screen.getByRole('textbox', { name: 'Espaços de magia de 1º nível: máximo' });
    await user.clear(max);
    await user.type(max, '4');
    await user.tab();
    const slots = await screen.findByRole('group', {
      name: /Espaços de magia de 1º nível: \d de 4/,
    });
    await user.click(
      within(slots).getByRole('button', { name: 'Espaços de magia de 1º nível: 1' }),
    );
    await waitFor(async () =>
      expect(await stored(sheet.id, 'espacos_1')).toMatchObject({ current: 1, max: 4 }),
    );
  });
});

describe('listas vazias', () => {
  it('seção de uma lista só: sem "Nenhum item", com o Adicionar no cabeçalho', async () => {
    const { user } = await openSheet();
    await user.click(screen.getByRole('tab', { name: 'Combate' }));
    const attacks = screen.getByRole('group', { name: 'Ataques' });
    expect(within(attacks).queryByText('Nenhum item.')).not.toBeInTheDocument();
    // O rótulo da lista não repete o título da seção.
    expect(within(attacks).getAllByText('Ataques')).toHaveLength(1);
    await user.click(within(attacks).getByRole('button', { name: 'Adicionar em Ataques' }));
    expect(within(attacks).getByLabelText('Nome (item 1)')).toBeInTheDocument();
  });
});
