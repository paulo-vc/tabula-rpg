import { useEffect } from 'react';
import { toast } from 'sonner';
import { findUpdate, tauriUpdater, type PendingUpdate, type Updater } from '@/app/desktop-updates';
import { useServices } from '@/app/services-context';
import { releasesUrl } from '@/app/updates';
import { isDesktopApp, openExternal } from '@/lib/open-external';

/**
 * No app desktop, oferece a versão nova: "Atualizar e reiniciar" baixa, confere a
 * assinatura, instala e reabre. (A versão web se atualiza sozinha pelo service worker.)
 */
export function UpdateNotice() {
  const { session } = useServices();

  useEffect(() => {
    if (!isDesktopApp()) return;
    let active = true;

    const install = async (updater: Updater, update: PendingUpdate) => {
      const progress = toast.loading(`Baixando a versão ${update.version}…`);
      try {
        // A sessão ao vivo guarda o estado antes de o app fechar para instalar.
        await session.flush();
        await update.install((fraction) => {
          const percent = fraction === null ? '' : ` ${Math.round(fraction * 100)}%`;
          toast.loading(`Baixando a versão ${update.version}…${percent}`, { id: progress });
        });
        toast.loading('Instalando e reiniciando…', { id: progress });
        await updater.relaunch();
      } catch (error) {
        toast.error('Não foi possível atualizar', {
          id: progress,
          description: `${error instanceof Error ? error.message : String(error)}. Você pode baixar a versão nova pela página de downloads.`,
          action: { label: 'Downloads', onClick: () => void openExternal(releasesUrl) },
        });
      }
    };

    void (async () => {
      const updater = await tauriUpdater().catch(() => null);
      const offer = await findUpdate(updater, __APP_VERSION__);
      if (!active || !offer) return;
      if (offer.kind === 'automatica' && updater) {
        toast.info(`Tabula RPG ${offer.update.version} disponível`, {
          description: 'A atualização é baixada e instalada sozinha; o app reabre em seguida.',
          duration: Infinity,
          action: {
            label: 'Atualizar e reiniciar',
            onClick: () => void install(updater, offer.update),
          },
        });
      } else if (offer.kind === 'manual') {
        toast.info(`Tabula RPG ${offer.update.version} disponível`, {
          description: 'Baixe a nova versão para receber as novidades e correções.',
          duration: Infinity,
          action: { label: 'Baixar', onClick: () => void openExternal(offer.update.url) },
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [session]);

  return null;
}
