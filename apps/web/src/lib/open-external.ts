/**
 * Abre um endereço externo no navegador do usuário. No app desktop, links comuns não
 * saem da janela do app: o plugin `opener` do Tauri entrega o endereço ao sistema.
 */
export async function openExternal(url: string): Promise<void> {
  if ('__TAURI_INTERNALS__' in window) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
