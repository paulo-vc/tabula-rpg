import { MAX_IMPORT_BYTES } from '@tabula/domain';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import { useServices } from '@/app/services-context';
import { pickFile } from '@/lib/browser-files';

/** Importa uma ficha ou sistema escolhido pelo usuário e informa o resultado. */
export function useImport() {
  const { files } = useServices();
  const [, navigate] = useLocation();

  return async () => {
    const file = await pickFile();
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error('Arquivo grande demais', { description: 'O limite é de 2 MB.' });
      return;
    }
    const result = await files.import(await file.text());
    if (!result.ok) {
      const [first, ...rest] = result.issues;
      toast.error('Não foi possível importar', {
        description: `${first?.message ?? 'Arquivo inválido.'}${rest.length ? ` (+${rest.length} problema(s))` : ''}`,
      });
      return;
    }
    if (result.kind === 'template') {
      toast.success(`Sistema "${result.template.name}" instalado`);
      navigate('/sistemas');
    } else {
      toast.success(`Ficha "${result.sheet.name}" importada`, {
        description: result.installedTemplate
          ? 'O sistema da ficha também foi instalado.'
          : undefined,
      });
      navigate(`/fichas/${result.sheet.id}`);
    }
  };
}
