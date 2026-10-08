import { checkForUpdate, type AvailableUpdate } from './updates';

/** Atualização encontrada pelo atualizador do app desktop (assinada e verificada por ele). */
export interface PendingUpdate {
  version: string;
  /** Baixa e instala. `progress` recebe a fração baixada (0 a 1), ou `null` se o tamanho é desconhecido. */
  install(progress: (fraction: number | null) => void): Promise<void>;
}

/** Atualizador do sistema (plugin do Tauri no app; falso nos testes). */
export interface Updater {
  check(): Promise<PendingUpdate | null>;
  /** Reabre o app depois de instalar. */
  relaunch(): Promise<void>;
}

export type UpdateOffer =
  /** Pode atualizar sozinho: baixar, instalar e reiniciar. */
  | { kind: 'automatica'; update: PendingUpdate }
  /** Há versão nova, mas só por download (ex.: o atualizador não está disponível). */
  | { kind: 'manual'; update: AvailableUpdate };

/**
 * Decide como oferecer a atualização. O atualizador automático tem prioridade; se ele
 * falhar (sem internet, release sem o arquivo de atualização), o app ainda avisa da versão
 * nova pelo catálogo de releases e leva à página de download.
 */
export async function findUpdate(
  updater: Updater | null,
  currentVersion: string,
  manual: (version: string) => Promise<AvailableUpdate | null> = checkForUpdate,
): Promise<UpdateOffer | null> {
  if (updater) {
    try {
      const update = await updater.check();
      if (update) return { kind: 'automatica', update };
      return null; // o atualizador respondeu: já está na versão mais nova
    } catch {
      // segue para o aviso manual
    }
  }
  const available = await manual(currentVersion);
  return available ? { kind: 'manual', update: available } : null;
}

/** Atualizador real do app desktop (carregado só lá: os plugins não existem na web). */
export async function tauriUpdater(): Promise<Updater> {
  const [{ check }, { relaunch }] = await Promise.all([
    import('@tauri-apps/plugin-updater'),
    import('@tauri-apps/plugin-process'),
  ]);
  return {
    relaunch,
    check: async () => {
      const update = await check();
      if (!update) return null;
      return {
        version: update.version,
        install: async (progress) => {
          let total = 0;
          let received = 0;
          await update.downloadAndInstall((event) => {
            if (event.event === 'Started') {
              total = event.data.contentLength ?? 0;
              progress(total > 0 ? 0 : null);
            } else if (event.event === 'Progress') {
              received += event.data.chunkLength;
              progress(total > 0 ? Math.min(1, received / total) : null);
            }
          });
        },
      };
    },
  };
}
