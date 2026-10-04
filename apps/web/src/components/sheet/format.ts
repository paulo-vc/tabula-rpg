const formatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** Formata um número para exibição. `signed` mostra "+" em positivos (ex.: modificadores). */
export function formatNumber(value: number, signed = false): string {
  const text = formatter.format(Math.abs(value));
  if (value < 0) return `−${text}`; // sinal de menos tipográfico
  return signed && value > 0 ? `+${text}` : text;
}

/** Converte o texto digitado num número, aceitando vírgula decimal. `null` se inválido. */
export function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(',', '.').replace('−', '-');
  if (normalized === '' || normalized === '-' || normalized === '.') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
