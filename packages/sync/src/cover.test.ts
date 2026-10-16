import type { Cover } from '@tabula/domain';
import { describe, expect, it } from 'vitest';
import { SessionClient } from './client';
import { SessionHost } from './host';
import { MemoryNetwork } from './memory-transport';
import { encodeCover } from './protocol';
import { newSheet, TEMPLATE } from './test-helpers';

const CAMPAIGN = { id: 'campanha', gmId: 'mestre', gmName: 'Paulo', templateId: TEMPLATE.id };

const cover = (marker: string): Cover => ({
  src: `data:image/webp;base64,UklGRgEAAABXRUJQVlA4IA${marker}==`,
  width: 1200,
  height: 630,
});

function setUp() {
  const network = new MemoryNetwork();
  const host = new SessionHost(network.join(), CAMPAIGN);
  host.start();
  const join = (userId: string, sheetId: string) => {
    const received: (Cover | null)[] = [];
    const transport = network.join();
    const client = new SessionClient(
      transport,
      CAMPAIGN,
      { userId, displayName: userId },
      newSheet(sheetId, userId),
      undefined,
      { onCover: (c) => received.push(c) },
    );
    client.start();
    return { client, received, transport };
  };
  return { network, host, join };
}

describe('capa da campanha', () => {
  it('quem entra recebe a capa; quem está online recebe as trocas', async () => {
    const { network, host, join } = setUp();
    const first = cover('A');
    host.setCover(first);
    const ana = join('ana', 's1');
    await network.settle();
    expect(ana.received).toEqual([first]);

    const second = cover('B');
    host.setCover(second);
    host.setCover({ ...second }); // a mesma: não reenvia
    host.setCover(null);
    await network.settle();
    expect(ana.received).toEqual([first, second, null]);
  });

  it('sem capa, quem entra recebe "nenhuma" (para apagar uma antiga)', async () => {
    const { network, join } = setUp();
    const ana = join('ana', 's1');
    await network.settle();
    expect(ana.received).toEqual([null]);
  });

  it('capa que não é imagem válida, ou que não vem do Mestre, é ignorada', async () => {
    const { network, join } = setUp();
    const ana = join('ana', 's1');
    const bia = join('bia', 's2');
    await network.settle();
    ana.received.length = 0;

    const svg = { ...cover('A'), src: 'data:image/svg+xml;base64,PHN2Zz4=' };
    for (const peer of network.peersOf(bia.transport)) {
      bia.transport.send(peer, encodeCover(cover('C')));
      bia.transport.send(peer, encodeCover(svg));
    }
    await network.settle();
    expect(ana.received).toEqual([]);
  });
});
