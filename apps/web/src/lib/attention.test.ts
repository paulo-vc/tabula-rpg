import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserAttention } from './attention';

describe('aviso fora do app', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.title = 'Tabularium RPG';
  });

  it('com o app em outra janela, o título pisca até a pessoa voltar', () => {
    vi.useFakeTimers();
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    document.title = 'Tabularium RPG';
    const attention = createBrowserAttention();

    attention.notify('Sua vez!', 'Rodada 1');
    vi.advanceTimersByTime(1000);
    expect(document.title).toBe('⚔ Sua vez!');
    vi.advanceTimersByTime(1000);
    expect(document.title).toBe('Tabularium RPG');
    vi.advanceTimersByTime(1000);
    expect(document.title).toBe('⚔ Sua vez!');

    focus.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    expect(document.title).toBe('Tabularium RPG');
    vi.advanceTimersByTime(5000);
    expect(document.title).toBe('Tabularium RPG');
  });

  it('com o app à vista, não faz nada (a faixa na tela basta)', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    document.title = 'Tabularium RPG';
    createBrowserAttention().notify('Sua vez!', 'Rodada 1');
    vi.advanceTimersByTime(3000);
    expect(document.title).toBe('Tabularium RPG');
  });
});
