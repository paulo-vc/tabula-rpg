import { useEffect } from 'react';
import { toast } from 'sonner';
import { checkForUpdate } from '@/app/updates';
import { isDesktopApp, openExternal } from '@/lib/open-external';

/**
 * No app desktop, avisa quando há versão nova para baixar. (A versão web se atualiza
 * sozinha pelo service worker.)
 */
export function UpdateNotice() {
  useEffect(() => {
    if (!isDesktopApp()) return;
    let active = true;
    void checkForUpdate(__APP_VERSION__).then((update) => {
      if (!active || !update) return;
      toast.info(`Tabula RPG ${update.version} disponível`, {
        description: 'Baixe a nova versão para receber as novidades e correções.',
        duration: Infinity,
        action: { label: 'Baixar', onClick: () => void openExternal(update.url) },
      });
    });
    return () => {
      active = false;
    };
  }, []);
  return null;
}
