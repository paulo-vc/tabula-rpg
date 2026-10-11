import { TabulaDatabase } from '@tabula/storage';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { createServices, type Services } from './app/services';

let db: TabulaDatabase;
let services: Services;

beforeEach(() => {
  window.location.hash = '';
  db = new TabulaDatabase(`ui-${crypto.randomUUID()}`);
  services = createServices(db);
});

afterEach(async () => {
  cleanup(); // desmonta o app antes de fechar o banco que ele usa
  db.close();
  await db.delete();
});

function renderApp() {
  const user = userEvent.setup();
  render(<App services={services} />);
  return user;
}

/** Cria uma ficha de D&D e abre a página dela. */
async function openNewSheet(name = 'Thorin') {
  const sheet = await services.sheets.create({ name, templateId: 'dnd5e-srd' });
  window.location.hash = `#/fichas/${sheet.id}`;
  const user = renderApp();
  await screen.findByRole('textbox', { name: 'Nome da ficha' });
  return { user, sheet };
}

/** Espera a gravação (com pausa de digitação) chegar ao banco. */
async function storedValue(sheetId: string, fieldId: string) {
  return (await db.sheets.get(sheetId))?.values[fieldId];
}

describe('lista de fichas', () => {
  it('mostra o estado vazio e cria uma ficha pelo diálogo', async () => {
    const user = renderApp();
    expect(await screen.findByText(/ainda não tem fichas/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nova ficha' }));
    const dialog = await screen.findByRole('dialog');
    const create = within(dialog).getByRole('button', { name: 'Criar ficha' });
    expect(create).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Nome do personagem'), 'Lia');
    await user.click(create);

    expect(await screen.findByRole('textbox', { name: 'Nome da ficha' })).toHaveValue('Lia');
    expect(window.location.hash).toMatch(/^#\/fichas\//);
    expect(screen.getByText('D&D 5ª Edição (SRD 5.1)')).toBeInTheDocument();
  });

  it('lista as fichas existentes com o nome do sistema', async () => {
    await services.sheets.create({ name: 'Thorin', templateId: 'dnd5e-srd' });
    renderApp();
    expect(await screen.findByRole('link', { name: /Thorin/ })).toHaveTextContent(
      'D&D 5ª Edição (SRD 5.1)',
    );
  });
});

describe('ficha', () => {
  it('recalcula campos derivados ao editar e grava o valor', async () => {
    const { user, sheet } = await openNewSheet();
    const strength = screen.getByLabelText('Força');
    expect(screen.getByRole('status', { name: 'Mod. Força' })).toHaveTextContent('0');

    await user.clear(strength);
    await user.type(strength, '16');

    // O cálculo é imediato; a gravação acontece após a pausa de digitação.
    expect(screen.getByRole('status', { name: 'Mod. Força' })).toHaveTextContent('+3');
    expect(screen.getByRole('status', { name: 'Atletismo (For)' })).toHaveTextContent('+3');
    await waitFor(async () => expect(await storedValue(sheet.id, 'for')).toBe(16));
  });

  it('aplica a proficiência ao marcar a caixa', async () => {
    const { user } = await openNewSheet();
    await user.click(screen.getByRole('checkbox', { name: 'Proficiente em Atletismo' }));
    expect(screen.getByRole('status', { name: 'Atletismo (For)' })).toHaveTextContent('+2');
  });

  it('não perde cliques rápidos nos botões de recurso', async () => {
    const { user, sheet } = await openNewSheet();
    await user.click(screen.getByRole('tab', { name: 'Combate' }));
    const plus = screen.getByRole('button', { name: 'Aumentar Pontos de Vida' });
    await user.click(plus);
    await user.click(plus);
    await user.click(plus);
    await user.click(screen.getByRole('button', { name: 'Diminuir Pontos de Vida' }));

    expect(screen.getByLabelText('Pontos de Vida: atual')).toHaveValue('12');
    await waitFor(async () =>
      expect(await storedValue(sheet.id, 'hp')).toEqual({ current: 12, max: 10 }),
    );
  });

  it('marca e desmarca condições', async () => {
    const { user, sheet } = await openNewSheet();
    await user.click(screen.getByRole('tab', { name: 'Combate' }));
    const conditions = screen.getByRole('group', { name: 'Condições' });
    const poisoned = within(conditions).getByRole('button', { name: 'Envenenado' });

    await user.click(poisoned);
    expect(poisoned).toHaveAttribute('aria-pressed', 'true');
    await waitFor(async () =>
      expect(await storedValue(sheet.id, 'condicoes')).toEqual(['envenenado']),
    );

    await user.click(poisoned);
    await waitFor(async () => expect(await storedValue(sheet.id, 'condicoes')).toEqual([]));
  });

  it('adiciona, edita e remove itens de uma lista', async () => {
    const { user, sheet } = await openNewSheet();
    await user.click(screen.getByRole('tab', { name: 'Inventário' }));
    const equipment = screen.getByRole('group', { name: 'Equipamento' });

    await user.click(within(equipment).getByRole('button', { name: 'Adicionar' }));
    await user.type(within(equipment).getByLabelText('Item (item 1)'), 'Corda');
    await waitFor(async () => {
      const items = (await storedValue(sheet.id, 'equipamento')) as { values: object }[];
      expect(items[0]?.values).toMatchObject({ nome: 'Corda' });
    });

    await user.click(within(equipment).getByRole('button', { name: 'Remover Corda' }));
    await waitFor(async () => expect(await storedValue(sheet.id, 'equipamento')).toEqual([]));
  });

  it('renomeia a ficha', async () => {
    const { user, sheet } = await openNewSheet();
    const name = screen.getByRole('textbox', { name: 'Nome da ficha' });
    await user.clear(name);
    await user.type(name, 'Thorin Escudo-de-Carvalho');
    await user.tab();
    await waitFor(async () =>
      expect((await db.sheets.get(sheet.id))?.name).toBe('Thorin Escudo-de-Carvalho'),
    );
  });

  it('exclui a ficha após confirmação', async () => {
    const { user, sheet } = await openNewSheet();
    await user.click(screen.getByRole('button', { name: 'Ações da ficha' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Excluir' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(window.location.hash).toBe('#/'));
    expect(await db.sheets.get(sheet.id)).toBeUndefined();
  });

  it('informa quando a ficha não existe', async () => {
    window.location.hash = '#/fichas/fantasma';
    renderApp();
    expect(await screen.findByText('Ficha não encontrada')).toBeInTheDocument();
  });
});

describe('sistemas', () => {
  it('lista o sistema nativo sem opção de remover', async () => {
    window.location.hash = '#/sistemas';
    renderApp();
    const card = (await screen.findByText('D&D 5ª Edição (SRD 5.1)')).closest('li');
    expect(card).not.toBeNull();
    const scoped = within(card as HTMLElement);
    expect(scoped.getByText('Nativo')).toBeInTheDocument();
    expect(scoped.getByRole('button', { name: 'Exportar' })).toBeInTheDocument();
    expect(scoped.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument();
  });
});
