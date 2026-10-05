/**
 * Endereço público do app, usado nos links de convite. Definido no build por
 * `VITE_PUBLIC_URL` (ex.: a versão web hospedada). Sem ele, usa o endereço atual se for
 * um site comum; dentro do app desktop não há endereço que outra pessoa consiga abrir,
 * e o convite é compartilhado como código.
 */
export function publicAppUrl(
  location: Pick<Location, 'protocol' | 'hostname' | 'href'> = window.location,
): string | null {
  const configured = import.meta.env.VITE_PUBLIC_URL as string | undefined;
  if (configured) return configured;
  const isWeb = location.protocol === 'https:' || location.protocol === 'http:';
  const isDesktop = location.hostname === 'tauri.localhost';
  return isWeb && !isDesktop ? (location.href.split('#')[0] as string) : null;
}
