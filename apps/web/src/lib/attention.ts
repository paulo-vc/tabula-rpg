import { isDesktopApp } from './open-external';

/** Chama a atenção para o app (injetável: nos testes, um que só anota). */
export interface Attention {
  /** Avisa fora do app, se ele não está à vista (outra janela ou outra aba). */
  notify(title: string, body: string): void;
}

const appInView = () => document.visibilityState === 'visible' && document.hasFocus();

/**
 * Fora do app, a pessoa não vê o aviso na tela. Então:
 * - o título da janela (ou da aba) pisca até ela voltar;
 * - no desktop, o ícone pisca na barra de tarefas (Tauri: `requestUserAttention`);
 * - na web, uma notificação do sistema, se a pessoa permitiu.
 */
export function createBrowserAttention(): Attention {
  let blinking: ReturnType<typeof setInterval> | undefined;
  let original = '';

  const stopBlinking = () => {
    if (blinking === undefined) return;
    clearInterval(blinking);
    blinking = undefined;
    document.title = original;
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', stopBlinking);
    document.addEventListener('visibilitychange', () => {
      if (appInView()) stopBlinking();
    });
  }

  return {
    notify(title, body) {
      if (appInView()) return;
      if (blinking === undefined) {
        original = document.title;
        let on = false;
        blinking = setInterval(() => {
          on = !on;
          document.title = on ? `⚔ ${title}` : original;
        }, 1000);
      }
      if (isDesktopApp()) {
        void import('@tauri-apps/api/window')
          .then(({ getCurrentWindow, UserAttentionType }) =>
            getCurrentWindow().requestUserAttention(UserAttentionType.Critical),
          )
          .catch(() => undefined);
        return;
      }
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const notification = new Notification(title, { body, tag: 'tabularium-aviso' });
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      }
    },
  };
}

/** Notificações do sistema na web: o estado da permissão (o desktop não usa). */
export type NotificationState = 'desktop' | 'indisponivel' | NotificationPermission;

export function notificationState(): NotificationState {
  if (isDesktopApp()) return 'desktop';
  if (typeof Notification === 'undefined') return 'indisponivel';
  return Notification.permission;
}

export async function askNotificationPermission(): Promise<NotificationState> {
  if (typeof Notification === 'undefined') return 'indisponivel';
  return Notification.requestPermission();
}
