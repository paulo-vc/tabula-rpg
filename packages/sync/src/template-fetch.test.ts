import type { SystemTemplate } from '@tabula/domain';
import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import { SessionHost } from './host';
import { MemoryNetwork } from './memory-transport';
import { decodeMessage, encodeHello, encodeTemplateRequest, PROTOCOL_VERSION } from './protocol';
import { fetchTemplate } from './template-fetch';
import { TEMPLATE } from './test-helpers';

const CAMPAIGN = { id: 'campanha', gmId: 'mestre', gmName: 'Paulo', templateId: TEMPLATE.id };

/** `null`: Mestre sem o sistema disponível. */
function startHost(network: MemoryNetwork, template: SystemTemplate | null = TEMPLATE) {
  const host = new SessionHost(network.join(), { ...CAMPAIGN, ...(template ? { template } : {}) });
  host.start();
  return host;
}

/** Processa a rede até a promessa resolver. */
async function run<T>(network: MemoryNetwork, promise: Promise<T>): Promise<T> {
  let settled = false;
  void promise.then(() => (settled = true));
  for (let i = 0; i < 200 && !settled; i++) {
    await network.settle();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return promise;
}

const request = (network: MemoryNetwork, timeoutMs = 2000, signal?: AbortSignal) =>
  fetchTemplate(network.join(), {
    campaign: { id: CAMPAIGN.id, gmId: CAMPAIGN.gmId },
    templateId: TEMPLATE.id,
    timeoutMs,
    ...(signal ? { signal } : {}),
  });

describe('envio do sistema pelo Mestre', () => {
  it('o jogador recebe o sistema da sessão aberta', async () => {
    const network = new MemoryNetwork();
    startHost(network);
    const result = await run(network, request(network));
    expect(result).toEqual({ ok: true, template: TEMPLATE });
  });

  it('o pedido espera o Mestre abrir a sessão', async () => {
    const network = new MemoryNetwork();
    const pending = request(network);
    await network.settle();
    startHost(network);
    expect(await run(network, pending)).toMatchObject({ ok: true });
  });

  it('sem Mestre, desiste depois do tempo limite', async () => {
    const network = new MemoryNetwork();
    expect(await run(network, request(network, 30))).toEqual({
      ok: false,
      reason: 'mestre-ausente',
    });
  });

  it('pode ser cancelado', async () => {
    const network = new MemoryNetwork();
    const controller = new AbortController();
    const pending = request(network, 5000, controller.signal);
    controller.abort();
    expect(await run(network, pending)).toEqual({ ok: false, reason: 'cancelado' });
  });

  it('ignora sistema enviado por quem não é o Mestre da campanha', async () => {
    const network = new MemoryNetwork();
    const impostor = network.join();
    impostor.setHandlers({
      onPeerJoin: (peerId) => {
        impostor.send(
          peerId,
          encodeHello({
            protocol: PROTOCOL_VERSION,
            role: 'mestre',
            campaignId: CAMPAIGN.id,
            userId: 'impostor',
            displayName: 'X',
          }),
        );
      },
      onPeerLeave: () => {},
      onMessage: () => {},
    });
    expect(await run(network, request(network, 50))).toEqual({
      ok: false,
      reason: 'mestre-ausente',
    });
  });

  it('recusa um sistema inválido (fórmula circular), mesmo vindo do Mestre', async () => {
    const network = new MemoryNetwork();
    const cyclic: SystemTemplate = {
      ...TEMPLATE,
      fields: [{ id: 'a', key: 'a', label: 'A', type: 'computed', formula: '@a + 1' }],
    };
    startHost(network, cyclic);
    expect(await run(network, request(network, 50))).toEqual({
      ok: false,
      reason: 'mestre-ausente',
    });
  });

  it('o Mestre sem o sistema não responde', async () => {
    const network = new MemoryNetwork();
    startHost(network, null);
    expect(await run(network, request(network, 50))).toMatchObject({ ok: false });
  });

  it('responde no máximo uma vez por conexão a quem insiste', async () => {
    const network = new MemoryNetwork();
    startHost(network);
    const spammer = network.join();
    let received = 0;
    spammer.setHandlers({
      onPeerJoin: (peerId) => {
        for (let i = 0; i < 10; i++) {
          spammer.send(
            peerId,
            encodeTemplateRequest({
              protocol: PROTOCOL_VERSION,
              campaignId: CAMPAIGN.id,
              templateId: TEMPLATE.id,
            }),
          );
        }
      },
      onPeerLeave: () => {},
      onMessage: (_, data) => {
        if (decodeMessage(data)?.type === 'template') received++;
      },
    });
    await network.settle();
    expect(received).toBe(1);
  });

  it('não responde a pedidos de outra campanha ou de outro sistema', async () => {
    const network = new MemoryNetwork();
    startHost(network);
    const peer = network.join();
    let received = 0;
    peer.setHandlers({
      onPeerJoin: (peerId) => {
        peer.send(
          peerId,
          encodeTemplateRequest({
            protocol: PROTOCOL_VERSION,
            campaignId: 'outra',
            templateId: TEMPLATE.id,
          }),
        );
        peer.send(
          peerId,
          encodeTemplateRequest({
            protocol: PROTOCOL_VERSION,
            campaignId: CAMPAIGN.id,
            templateId: 'outro',
          }),
        );
      },
      onPeerLeave: () => {},
      onMessage: (_, data) => {
        if (decodeMessage(data)?.type === 'template') received++;
      },
    });
    await network.settle();
    expect(received).toBe(0);
  });

  it('mensagem TEMPLATE com JSON quebrado é descartada pelo protocolo', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 4);
    encoding.writeVarString(encoder, '{"id":');
    expect(decodeMessage(encoding.toUint8Array(encoder))).toBeNull();
  });
});
