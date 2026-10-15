import type { Cutscene } from '@tabula/domain';
import { describe, expect, it } from 'vitest';
import { SessionClient } from './client';
import { SessionHost } from './host';
import { generateGmKeyPair } from './identity';
import { chunkImage, hashImage, ImageAssembler } from './image-transfer';
import { MemoryNetwork } from './memory-transport';
import { encodeCutscene } from './protocol';
import { newSheet, TEMPLATE } from './test-helpers';

const gm = generateGmKeyPair();
const CAMPAIGN = { id: 'campanha', gmId: 'mestre', gmName: 'Paulo', templateId: TEMPLATE.id };

/** "PNG" de ~600 KB (3 partes): cabeçalho de PNG e o resto pseudoaleatório. */
function fakePng(size = 600_000, seed = 7): Uint8Array {
  const bytes = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i++) bytes[i] = (x = (x * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  return bytes;
}

const infoFor = (data: Uint8Array, title = 'O dragão'): Cutscene => ({
  hash: hashImage(data),
  mime: 'image/png',
  size: data.byteLength,
  width: 1600,
  height: 900,
  title,
  caption: '',
});

function startHost(network: MemoryNetwork) {
  const host = new SessionHost(network.join(), { ...CAMPAIGN, identity: gm });
  host.start();
  return host;
}

function startPlayer(network: MemoryNetwork) {
  const seen: (Cutscene | null)[] = [];
  const images: { hash: string; data: Uint8Array }[] = [];
  const client = new SessionClient(
    network.join(),
    { id: CAMPAIGN.id, gmId: CAMPAIGN.gmId, gmKey: gm.publicKey },
    { userId: 'ana', displayName: 'Ana' },
    newSheet('s1', 'ana'),
    undefined,
    {
      onCutscene: (cutscene) => seen.push(cutscene),
      onImage: (hash, data) => images.push({ hash, data }),
    },
  );
  client.start();
  return { client, seen, images };
}

describe('cutscene na sessão', () => {
  it('o Mestre mostra; quem não tem a imagem pede e a recebe inteira e conferida', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    const { client, seen, images } = startPlayer(network);
    await network.settle();

    const data = fakePng();
    host.setCutscene(infoFor(data), data);
    await network.settle();
    expect(seen.at(-1)).toMatchObject({ title: 'O dragão', size: 600_000 });

    client.requestImage(hashImage(data));
    await network.settle();
    expect(images).toHaveLength(1);
    expect(images[0]?.hash).toBe(hashImage(data));
    expect(images[0]?.data).toEqual(data);

    host.setCutscene(null);
    await network.settle();
    expect(seen.at(-1)).toBeNull();
  });

  it('quem entra depois vê a imagem que está sendo mostrada', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    const data = fakePng(1000);
    host.setCutscene(infoFor(data), data);
    const { seen } = startPlayer(network);
    await network.settle();
    expect(seen).toEqual([infoFor(data)]);
  });

  it('só a imagem mostrada é entregue: pedir outro hash não baixa nada da galeria', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network);
    const { client, images } = startPlayer(network);
    await network.settle();
    const shown = fakePng(1000, 1);
    host.setCutscene(infoFor(shown), shown);
    await network.settle();
    client.requestImage(hashImage(fakePng(1000, 2))); // não é a mostrada
    await network.settle();
    expect(images).toEqual([]);
  });

  it('cutscene enviada por quem não provou ser o Mestre é ignorada', async () => {
    const network = new MemoryNetwork();
    const { seen } = startPlayer(network);
    const attacker = network.join();
    attacker.setHandlers({
      onPeerJoin: (peerId) => attacker.send(peerId, encodeCutscene(infoFor(fakePng(1000)))),
      onPeerLeave: () => {},
      onMessage: () => {},
    });
    await network.settle();
    expect(seen).toEqual([]);
  });
});

describe('montagem da imagem', () => {
  const data = fakePng();
  const parts = chunkImage(data);
  const info = infoFor(data);

  it('aceita as partes em qualquer ordem e confere o conteúdo', () => {
    const assembler = new ImageAssembler(info);
    expect(assembler.add(info.hash, 2, parts.length, parts[2] as Uint8Array)).toBeNull();
    expect(assembler.add(info.hash, 0, parts.length, parts[0] as Uint8Array)).toBeNull();
    expect(assembler.add(info.hash, 1, parts.length, parts[1] as Uint8Array)).toEqual(data);
  });

  it('conteúdo adulterado não passa (o hash não confere)', () => {
    const assembler = new ImageAssembler(info);
    const tampered = (parts[1] as Uint8Array).slice();
    tampered[10] = (tampered[10] ?? 0) ^ 0xff;
    assembler.add(info.hash, 0, parts.length, parts[0] as Uint8Array);
    assembler.add(info.hash, 2, parts.length, parts[2] as Uint8Array);
    expect(assembler.add(info.hash, 1, parts.length, tampered)).toBeNull();
  });

  it('ignora parte de outra imagem, total errado, tamanho errado e repetida', () => {
    const assembler = new ImageAssembler(info);
    const first = parts[0] as Uint8Array;
    expect(assembler.add('b'.repeat(64), 0, parts.length, first)).toBeNull();
    expect(assembler.add(info.hash, 0, parts.length + 1, first)).toBeNull();
    expect(assembler.add(info.hash, 0, parts.length, first.subarray(1))).toBeNull();
    expect(assembler.add(info.hash, 0, parts.length, first)).toBeNull();
    // Repetir a parte 0 (agora aceita) não conta duas vezes.
    expect(assembler.add(info.hash, 0, parts.length, first)).toBeNull();
    assembler.add(info.hash, 1, parts.length, parts[1] as Uint8Array);
    expect(assembler.add(info.hash, 2, parts.length, parts[2] as Uint8Array)).toEqual(data);
  });

  it('tipo real diferente do declarado não passa (ex.: SVG disfarçado)', () => {
    const svg = Uint8Array.from('<svg xmlns="http://www.w3.org/2000/svg"/>', (c) =>
      c.charCodeAt(0),
    );
    const disguised = { ...infoFor(svg), size: svg.byteLength };
    const assembler = new ImageAssembler(disguised);
    expect(assembler.add(disguised.hash, 0, 1, svg)).toBeNull();
  });
});
