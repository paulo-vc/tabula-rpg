import { describe, expect, it } from 'vitest';
import { SessionClient, type ClientCampaign } from './client';
import { SessionHost } from './host';
import {
  fromBase64Url,
  generateGmKeyPair,
  newChallenge,
  signChallenge,
  verifyChallenge,
} from './identity';
import { MemoryNetwork } from './memory-transport';
import { encodeHello, encodeReject, PROTOCOL_VERSION } from './protocol';
import { newSheet, TEMPLATE } from './test-helpers';

const HOST_CAMPAIGN = { id: 'campanha', gmId: 'mestre', gmName: 'Paulo', templateId: TEMPLATE.id };
const gm = generateGmKeyPair();

function startHost(network: MemoryNetwork, identity?: typeof gm) {
  const host = new SessionHost(network.join(), { ...HOST_CAMPAIGN, ...(identity && { identity }) });
  host.start();
  return host;
}

function startPlayer(
  network: MemoryNetwork,
  campaign: ClientCampaign,
  onGmKeyLearned?: (key: string) => void,
) {
  const client = new SessionClient(
    network.join(),
    campaign,
    { userId: 'ana', displayName: 'Ana' },
    newSheet('s1', 'ana'),
    undefined,
    onGmKeyLearned ? { onGmKeyLearned } : {},
  );
  client.start();
  return client;
}

const INVITE: ClientCampaign = { id: 'campanha', gmId: 'mestre', gmKey: gm.publicKey };

describe('identidade do Mestre (criptografia)', () => {
  it('gera chaves de 32 bytes e a prova confere', () => {
    expect(fromBase64Url(gm.publicKey)).toHaveLength(32);
    expect(fromBase64Url(gm.secretKey)).toHaveLength(32);
    const challenge = newChallenge();
    const proof = signChallenge(gm.secretKey, 'campanha', challenge, 'mestre');
    expect(verifyChallenge(gm.publicKey, proof, 'campanha', challenge, 'mestre')).toBe(true);
  });

  it('a prova só vale para o desafio, a campanha, o Mestre e a chave originais', () => {
    const challenge = newChallenge();
    const proof = signChallenge(gm.secretKey, 'campanha', challenge, 'mestre');
    const other = generateGmKeyPair();
    expect(verifyChallenge(gm.publicKey, proof, 'campanha', newChallenge(), 'mestre')).toBe(false);
    expect(verifyChallenge(gm.publicKey, proof, 'outra', challenge, 'mestre')).toBe(false);
    expect(verifyChallenge(gm.publicKey, proof, 'campanha', challenge, 'outro')).toBe(false);
    expect(verifyChallenge(other.publicKey, proof, 'campanha', challenge, 'mestre')).toBe(false);
  });

  it('entradas malformadas dão falso, sem lançar exceção', () => {
    const challenge = newChallenge();
    for (const [key, proof] of [
      ['', ''],
      ['não é base64!', 'também não'],
      [gm.publicKey, 'AAAA'],
      ['AAAA', signChallenge(gm.secretKey, 'campanha', challenge, 'mestre')],
    ] as const) {
      expect(verifyChallenge(key, proof, 'campanha', challenge, 'mestre')).toBe(false);
    }
    expect(() => signChallenge('curta', 'campanha', challenge, 'mestre')).toThrow();
  });
});

describe('sessão com identidade do Mestre', () => {
  it('o jogador com a chave do convite conecta ao Mestre verdadeiro', async () => {
    const network = new MemoryNetwork();
    startHost(network, gm);
    const client = startPlayer(network, INVITE);
    await network.settle();

    expect(client.status()).toEqual({ state: 'conectado' });
    expect(client.identity()).toBe('verificada');
  });

  it('quem só tem o convite não se passa pelo Mestre', async () => {
    const network = new MemoryNetwork();
    const client = startPlayer(network, INVITE);
    // O impostor conhece campanha, ID do Mestre e segredo, mas não a chave privada.
    startHost(network);
    await network.settle();
    expect(client.status()).toEqual({ state: 'procurando-mestre' });
    expect(client.identity()).toBeNull();

    // Quando o Mestre verdadeiro chega, a sessão acontece normalmente.
    startHost(network, gm);
    await network.settle();
    expect(client.status()).toEqual({ state: 'conectado' });
    expect(client.identity()).toBe('verificada');
  });

  it('um impostor com chave própria também é recusado', async () => {
    const network = new MemoryNetwork();
    const client = startPlayer(network, INVITE);
    startHost(network, generateGmKeyPair());
    await network.settle();
    expect(client.status()).toEqual({ state: 'procurando-mestre' });
  });

  it('a prova de uma conexão antiga não vale em outra (replay)', async () => {
    const network = new MemoryNetwork();
    // Prova legítima, mas assinada para o desafio de OUTRO jogador.
    const stolen = signChallenge(gm.secretKey, 'campanha', newChallenge(), 'mestre');
    const attacker = network.join();
    attacker.setHandlers({
      onPeerJoin: (peerId) =>
        attacker.send(
          peerId,
          encodeHello({
            protocol: PROTOCOL_VERSION,
            role: 'mestre',
            campaignId: 'campanha',
            userId: 'mestre',
            displayName: 'Paulo',
            gmKey: gm.publicKey,
            proof: stolen,
          }),
        ),
      onPeerLeave: () => {},
      onMessage: () => {},
    });
    const client = startPlayer(network, INVITE);
    await network.settle();
    expect(client.status()).toEqual({ state: 'procurando-mestre' });
  });

  it('recusas e mensagens de quem não provou ser o Mestre são ignoradas', async () => {
    const network = new MemoryNetwork();
    const attacker = network.join();
    attacker.setHandlers({
      onPeerJoin: (peerId) => {
        attacker.send(
          peerId,
          encodeReject({ code: 'sala-cheia', message: 'Sessão lotada (mentira).' }),
        );
      },
      onPeerLeave: () => {},
      onMessage: () => {},
    });
    const client = startPlayer(network, INVITE);
    startHost(network, gm);
    await network.settle();
    expect(client.status()).toEqual({ state: 'conectado' });
  });

  it('o Mestre verdadeiro ainda consegue recusar, e o jogador acredita', async () => {
    const network = new MemoryNetwork();
    startHost(network, gm);
    const client = startPlayer(network, { ...INVITE, id: 'outra-campanha' });
    await network.settle();
    // Campanha diferente: o Mestre não responde como dono daquela campanha.
    expect(client.status().state).not.toBe('conectado');
  });
});

describe('compatibilidade com campanhas da v0.1 (sem chave)', () => {
  const LEGACY: ClientCampaign = { id: 'campanha', gmId: 'mestre' };

  it('fixa a chave do Mestre na primeira prova e avisa para gravá-la', async () => {
    const network = new MemoryNetwork();
    startHost(network, gm);
    const learned: string[] = [];
    const client = startPlayer(network, LEGACY, (key) => learned.push(key));
    await network.settle();

    expect(client.status()).toEqual({ state: 'conectado' });
    expect(client.identity()).toBe('verificada');
    expect(learned).toEqual([gm.publicKey]);
  });

  it('depois de fixada, outra chave não é aceita nem avisa de novo', async () => {
    const network = new MemoryNetwork();
    const learned: string[] = [];
    const client = startPlayer(network, LEGACY, (key) => learned.push(key));
    const realHost = startHost(network, gm);
    await network.settle();
    expect(learned).toEqual([gm.publicKey]);

    // O Mestre verdadeiro sai; um impostor com outra chave tenta assumir.
    await realHost.stop();
    await network.settle();
    expect(client.status()).toEqual({ state: 'procurando-mestre' });
    startHost(network, generateGmKeyPair());
    await network.settle();
    expect(client.status()).toEqual({ state: 'procurando-mestre' });
    expect(learned).toHaveLength(1);
  });

  it('um Mestre da v0.1 (que não assina) ainda funciona, como identidade declarada', async () => {
    const network = new MemoryNetwork();
    startHost(network);
    const client = startPlayer(network, LEGACY);
    await network.settle();
    expect(client.status()).toEqual({ state: 'conectado' });
    expect(client.identity()).toBe('declarada');
  });

  it('com a chave no convite, um Mestre que não assina é recusado (sem rebaixamento)', async () => {
    const network = new MemoryNetwork();
    startHost(network);
    const client = startPlayer(network, INVITE);
    await network.settle();
    expect(client.status()).toEqual({ state: 'procurando-mestre' });
  });

  it('um jogador da v0.1 (sem desafio) entra normalmente num Mestre com identidade', async () => {
    const network = new MemoryNetwork();
    const host = startHost(network, gm);
    const legacyPlayer = network.join();
    legacyPlayer.setHandlers({
      onPeerJoin: (peerId) =>
        legacyPlayer.send(
          peerId,
          encodeHello({
            protocol: PROTOCOL_VERSION,
            role: 'jogador',
            campaignId: 'campanha',
            userId: 'bia',
            displayName: 'Bia',
            sheetId: 's9',
            templateId: TEMPLATE.id,
          }),
        ),
      onPeerLeave: () => {},
      onMessage: () => {},
    });
    await network.settle();
    expect(host.players().find((p) => p.userId === 'bia')?.online).toBe(true);
  });
});
