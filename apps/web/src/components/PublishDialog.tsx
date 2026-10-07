import type { SystemTemplate } from '@tabula/domain';
import { ExternalLinkIcon } from 'lucide-react';
import { useServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { downloadFile } from '@/lib/browser-files';
import { openExternal } from '@/lib/open-external';

/**
 * Publicação sem Git: o app baixa o arquivo do sistema e abre o formulário do GitHub;
 * o usuário só arrasta o arquivo e escolhe a licença. A automação do repositório valida
 * e abre o pedido de inclusão.
 */
export function PublishDialog({
  template,
  onClose,
}: {
  template: SystemTemplate | null;
  onClose: () => void;
}) {
  const { files, registry } = useServices();

  const start = async () => {
    if (!template) return;
    const file = files.exportTemplate(template);
    downloadFile(file);
    await openExternal(registry.publishUrl(template));
    onClose();
  };

  return (
    <Dialog open={template !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publicar "{template?.name}" na comunidade</DialogTitle>
          <DialogDescription>
            O sistema fica disponível para qualquer pessoa instalar pelo app. É gratuito e precisa
            de uma conta no GitHub.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>O arquivo do sistema será baixado e a página de publicação abrirá no navegador.</li>
          <li>
            Arraste o arquivo baixado para o campo <strong>Arquivo do sistema</strong>, escolha a
            licença e clique em <strong>Create</strong>.
          </li>
          <li>
            Uma verificação automática responde em poucos minutos. Depois da revisão, o sistema
            aparece em <strong>Explorar comunidade</strong>.
          </li>
        </ol>
        <p className="text-muted-foreground text-sm">
          Publique apenas conteúdo que você tem o direito de compartilhar: textos copiados de livros
          são recusados.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={start}>
            <ExternalLinkIcon /> Baixar e abrir o GitHub
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
