import type { SystemTemplate } from '@tabula/domain';
import { decodeMessage, encodeTemplateRequest, PROTOCOL_VERSION } from './protocol';
import type { SyncTransport } from './transport';

export type TemplateFetchResult =
  | { ok: true; template: SystemTemplate }
  | { ok: false; reason: 'mestre-ausente' | 'falha-de-conexao' | 'cancelado' };

export interface TemplateFetchOptions {
  campaign: { id: string; gmId: string };
  templateId: string;
  /** Desiste depois deste tempo sem resposta do Mestre. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Pede ao Mestre o sistema da campanha. Usado por quem ainda não tem o sistema instalado
 * (e por isso ainda não tem ficha para entrar na sessão). Entra na sala, espera o Mestre se
 * apresentar, pede o sistema e sai. O sistema recebido já chega validado (ver protocolo).
 */
export function fetchTemplate(
  transport: SyncTransport,
  { campaign, templateId, timeoutMs = 60_000, signal }: TemplateFetchOptions,
): Promise<TemplateFetchResult> {
  return new Promise((resolve) => {
    let gmPeer: string | null = null;
    let failures = 0;
    let done = false;

    const finish = (result: TemplateFetchResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      void transport.leave();
      resolve(result);
    };
    const onAbort = () => finish({ ok: false, reason: 'cancelado' });
    const timer = setTimeout(
      () => finish({ ok: false, reason: failures > 0 ? 'falha-de-conexao' : 'mestre-ausente' }),
      timeoutMs,
    );
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);

    transport.setHandlers({
      onPeerJoin: () => {},
      onPeerLeave: (peerId) => {
        if (peerId === gmPeer) gmPeer = null;
      },
      onConnectionFailure: () => failures++,
      onMessage: (peerId, data) => {
        const message = decodeMessage(data);
        if (!message) return;
        if (
          message.type === 'hello' &&
          message.hello.role === 'mestre' &&
          message.hello.userId === campaign.gmId &&
          message.hello.campaignId === campaign.id
        ) {
          gmPeer = peerId;
          transport.send(
            peerId,
            encodeTemplateRequest({
              protocol: PROTOCOL_VERSION,
              campaignId: campaign.id,
              templateId,
            }),
          );
        } else if (
          message.type === 'template' &&
          peerId === gmPeer &&
          message.template.id === templateId
        ) {
          finish({ ok: true, template: message.template });
        }
      },
    });
  });
}
