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
  cleanup();
  db.close();
  await db.delete();
});

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App services={services} />);
  return user;
}

const preview = () => screen.getByRole('region', { name: 'Prévia da ficha' });

/** Abre o editor de um sistema novo em branco. */
async function openBlankEditor(name = 'Minha Fantasia') {
  const draft = await services.editor.createBlank(name);
  const user = renderAt(`#/sistemas/editor/${draft.id}`);
  await screen.findByRole('heading', { name });
  return { user, draft };
}

async function addField(user: ReturnType<typeof userEvent.setup>, label: string, type: string) {
  await user.click(screen.getByRole('button', { name: 'Campo' }));
  const dialog = await screen.findByRole('dialog', { name: 'Novo campo' });
  await user.type(within(dialog).getByLabelText('Nome na ficha'), label);
  await user.click(within(dialog).getByText(type));
  await user.click(within(dialog).getByRole('button', { name: 'Adicionar' }));
  // Em seguida abre a edição do campo criado.
  return screen.findByRole('dialog', { name: label });
}

describe('criador de sistemas', () => {
  it('cria um sistema pela lista de sistemas', async () => {
    const user = renderAt('#/sistemas');
    await user.click(await screen.findByRole('button', { name: 'Criar sistema' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nome do sistema'), 'Minha Fantasia');
    await user.click(within(dialog).getByRole('button', { name: 'Começar a editar' }));

    expect(await screen.findByRole('heading', { name: 'Minha Fantasia' })).toBeInTheDocument();
    expect(window.location.hash).toMatch(/^#\/sistemas\/editor\//);
  });

  it('campo calculado: a prévia aplica a fórmula; erros aparecem no campo', async () => {
    const { user } = await openBlankEditor();

    let dialog = await addField(user, 'Força', 'Número');
    const initial = within(dialog).getByLabelText('Valor inicial');
    await user.clear(initial);
    await user.type(initial, '14');
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    dialog = await addField(user, 'Mod Força', 'Calculado (fórmula)');
    const formula = within(dialog).getByLabelText('Fórmula');
    await user.clear(formula);
    await user.type(formula, 'floor((@forc - 10) / 2)');
    expect(await within(dialog).findByText('Campo inexistente: @forc')).toBeInTheDocument();

    await user.clear(formula);
    await user.type(formula, 'floor((');
    await user.click(within(dialog).getByRole('button', { name: '@forca' }));
    await user.type(formula, ' - 10) / 2)');
    expect(formula).toHaveValue('floor((@forca - 10) / 2)');
    expect(within(dialog).queryByLabelText('Problemas do campo')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => expect(within(preview()).getByText('2')).toBeInTheDocument());
    const strength = within(preview()).getByRole('textbox', { name: 'Força' });
    await user.clear(strength);
    await user.type(strength, '18');
    await waitFor(() => expect(within(preview()).getByText('4')).toBeInTheDocument());
  });

  it('não salva com problemas; desfazer volta ao estado válido', async () => {
    const { user } = await openBlankEditor();
    const dialog = await addField(user, 'Total', 'Calculado (fórmula)');
    const formula = within(dialog).getByLabelText('Fórmula');
    await user.clear(formula);
    await user.type(formula, '@nada');
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar' }));

    expect(await screen.findByText(/1 problema para corrigir/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar sistema' })).toBeDisabled();
    expect(screen.getByText(/A prévia mostra a última versão sem problemas/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Salvar sistema' })).toBeEnabled(),
    );
  });

  it('salva, aparece na lista e pode ser editado de novo com versão nova', async () => {
    const { user } = await openBlankEditor();
    await addField(user, 'Sorte', 'Número');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await user.click(screen.getByRole('button', { name: 'Salvar sistema' }));

    expect(await screen.findByRole('heading', { name: 'Sistemas' })).toBeInTheDocument();
    expect(await services.catalog.get('minha-fantasia')).toMatchObject({ version: '1.0.0' });
    expect(await services.editor.list()).toEqual([]);

    await user.click(await screen.findByRole('button', { name: 'Editar' }));
    await screen.findByRole('heading', { name: 'Minha Fantasia' });
    await user.click(screen.getByRole('button', { name: 'Excluir Sorte' }));
    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    await user.click(screen.getByRole('button', { name: 'Salvar sistema' }));

    await screen.findByRole('heading', { name: 'Sistemas' });
    const saved = await services.catalog.get('minha-fantasia');
    expect(saved?.version).toBe('1.0.1');
    expect(saved?.fields.map((f) => f.id)).toEqual(['nome']);
  });

  it('organiza seções e informa o sistema', async () => {
    const { user, draft } = await openBlankEditor();
    await user.click(screen.getByRole('button', { name: 'Nova seção' }));
    const titles = screen.getAllByRole('textbox', { name: 'Título da seção' });
    expect(titles.map((t) => (t as HTMLInputElement).value)).toEqual(['Personagem', 'Seção 2']);

    await user.click(screen.getByRole('button', { name: 'Mover Nome para outra seção' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Seção 2' }));
    expect(screen.getByRole('button', { name: 'Excluir seção Personagem' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Excluir seção Personagem' }));
    expect(screen.getAllByRole('textbox', { name: 'Título da seção' })).toHaveLength(1);

    await user.click(screen.getByRole('tab', { name: 'Informações' }));
    await user.type(screen.getByLabelText('Licença'), 'CC-BY-4.0');
    await waitFor(async () =>
      expect((await services.editor.get(draft.id))?.template.license).toBe('CC-BY-4.0'),
    );
  });

  it('copiar o D&D gera um sistema editável', async () => {
    const user = renderAt('#/sistemas');
    await user.click(await screen.findByRole('button', { name: 'Criar sistema' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox'));
    await user.click(
      await screen.findByRole('option', { name: 'Cópia de D&D 5ª Edição (SRD 5.1)' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Começar a editar' }));

    expect(
      await screen.findByRole('heading', { name: 'D&D 5ª Edição (SRD 5.1) (cópia)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar sistema' })).toBeEnabled();
    expect(screen.getAllByRole('textbox', { name: 'Título da seção' }).length).toBeGreaterThan(5);
  });
});
