import type { ExportFile } from '@/app/files';

/** Oferece o arquivo para download no navegador. */
export function downloadFile({ filename, content }: ExportFile): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Dá tempo ao navegador para iniciar o download antes de liberar a URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Abre o seletor de arquivos e devolve o arquivo escolhido (ou `null`). Quem chama verifica
 * o tamanho antes de ler o conteúdo, para não carregar arquivos enormes na memória.
 */
export function pickFile(accept = '.json,application/json'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
