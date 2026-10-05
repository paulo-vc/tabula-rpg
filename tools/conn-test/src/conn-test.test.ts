import { describe, expect, it } from 'vitest';
import { describeConnection, type StatsEntry } from './connection';
import { diagnoseNat, type GatheredCandidate } from './nat';
import { formatReport, newRoomCode, normalizeRoomCode } from './report';

const host = (address: string, port = 50000): GatheredCandidate => ({
  type: 'host',
  address,
  port,
  protocol: 'udp',
});
const srflx = (address: string, port: number): GatheredCandidate => ({
  type: 'srflx',
  address,
  port,
  protocol: 'udp',
});

describe('diagnoseNat', () => {
  it('NAT cone: os dois servidores respondem e a porta pública é a mesma', () => {
    const result = diagnoseNat([host('abc.local'), srflx('200.1.2.3', 40000)], 2);
    expect(result).toEqual({ natType: 'cone', ipv6: false, reachableServers: 2 });
  });

  it('NAT simétrico: portas públicas diferentes para o mesmo IP', () => {
    const candidates = [host('abc.local'), srflx('200.1.2.3', 40000), srflx('200.1.2.3', 40007)];
    expect(diagnoseNat(candidates, 2).natType).toBe('simetrico');
  });

  it('simétrico é detectado mesmo se só um servidor respondeu isoladamente', () => {
    const candidates = [srflx('200.1.2.3', 40000), srflx('200.1.2.3', 40007)];
    expect(diagnoseNat(candidates, 1).natType).toBe('simetrico');
  });

  it('uma porta só, mas um servidor respondeu: não dá para concluir', () => {
    expect(diagnoseNat([srflx('200.1.2.3', 40000)], 1).natType).toBe('indeterminado');
  });

  it('UDP bloqueado: nenhum servidor responde', () => {
    expect(diagnoseNat([host('abc.local')], 0)).toEqual({
      natType: 'udp-bloqueado',
      ipv6: false,
      reachableServers: 0,
    });
  });

  it('sem NAT: o endereço público é o próprio endereço local', () => {
    const candidates = [host('200.1.2.3'), srflx('200.1.2.3', 50000)];
    expect(diagnoseNat(candidates, 2).natType).toBe('aberto');
  });

  it('detecta IPv6 público e considera aberto quando só há IPv6', () => {
    const result = diagnoseNat([srflx('2804:14c::1', 50000)], 2);
    expect(result).toMatchObject({ natType: 'aberto', ipv6: true });
  });

  it('ignora candidatos TCP', () => {
    const tcp: GatheredCandidate = { ...srflx('200.1.2.3', 1), protocol: 'tcp' };
    expect(diagnoseNat([tcp], 2).natType).toBe('udp-bloqueado');
  });
});

describe('describeConnection', () => {
  const stats = (localType: string, remoteType: string, address = '192.168.0.10'): StatsEntry[] => [
    { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
    {
      id: 'P1',
      type: 'candidate-pair',
      localCandidateId: 'L1',
      remoteCandidateId: 'R1',
      currentRoundTripTime: 0.0234,
    },
    { id: 'L1', type: 'local-candidate', candidateType: localType, address, protocol: 'udp' },
    { id: 'R1', type: 'remote-candidate', candidateType: remoteType },
  ];

  it.each([
    ['host', 'host', 'rede-local'],
    ['srflx', 'host', 'direta'],
    ['host', 'prflx', 'direta'],
    ['srflx', 'srflx', 'direta'],
    ['relay', 'srflx', 'relay'],
  ])('%s + %s = %s', (local, remote, kind) => {
    expect(describeConnection(stats(local, remote))?.kind).toBe(kind);
  });

  it('informa versão do IP, protocolo e latência', () => {
    expect(describeConnection(stats('srflx', 'srflx', '2804::1'))).toEqual({
      kind: 'direta',
      ipVersion: 6,
      protocol: 'udp',
      rttMs: 23,
    });
  });

  it('usa o par nomeado quando o transporte não aponta o par (Firefox)', () => {
    const entries = stats('srflx', 'srflx').filter((e) => e.type !== 'transport');
    (entries[0] as StatsEntry).state = 'succeeded';
    (entries[0] as StatsEntry).nominated = true;
    expect(describeConnection(entries)?.kind).toBe('direta');
  });

  it('devolve null sem par ativo', () => {
    expect(describeConnection([])).toBeNull();
  });
});

describe('códigos de sala', () => {
  it('gera códigos no formato XXXX-XXXX sem caracteres ambíguos', () => {
    for (let i = 0; i < 200; i++)
      expect(newRoomCode()).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  });

  it('descarta bytes que causariam viés', () => {
    // 255 está acima do último múltiplo de 31 (248) e deve ser ignorado.
    let call = 0;
    const code = newRoomCode((bytes) => {
      bytes.fill(call++ === 0 ? 255 : 0);
      return bytes;
    });
    expect(code).toBe('AAAA-AAAA');
  });

  it.each([
    ['k7qm xr4p', 'K7QM-XR4P'],
    ['K7QM-XR4P', 'K7QM-XR4P'],
    [' k7qmxr4p ', 'K7QM-XR4P'],
    ['K7QM-XR4', null],
    ['O0O0-1111', null],
  ])('normalizeRoomCode(%j) = %j', (input, expected) => {
    expect(normalizeRoomCode(input)).toBe(expected);
  });
});

describe('formatReport', () => {
  const base = {
    name: 'Ana',
    network: 'Fibra',
    userAgent: 'Mozilla/5.0 Chrome/140.0',
    nat: { natType: 'cone' as const, ipv6: true, reachableServers: 2 },
    roomCode: 'K7QM-XR4P',
    failures: 1,
    peers: [
      {
        name: 'Bia',
        outcome: {
          ok: true as const,
          seconds: 2.34,
          connection: {
            kind: 'direta' as const,
            ipVersion: 4 as const,
            protocol: 'udp',
            rttMs: 23,
          },
        },
      },
      { name: 'Caio', outcome: { ok: false as const } },
    ],
  };

  it('resume a rede e cada conexão', () => {
    expect(formatReport(base)).toBe(
      [
        '== Tabula RPG — teste de conexão ==',
        'Participante: Ana',
        'Rede: Fibra',
        'Navegador: Chrome',
        'NAT: cone — NAT comum ("cone"): conexões diretas costumam funcionar.',
        'IPv6 público: sim',
        'Sala: K7QM-XR4P',
        '- Bia: Direta pela internet, IPv4, 23 ms (em 2.3 s)',
        '- Caio: FALHOU',
        'Falhas de conexão direta: 1',
      ].join('\n'),
    );
  });

  it('nunca inclui endereços IP', () => {
    const text = formatReport(base);
    expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(text).not.toMatch(/[0-9a-f]{1,4}:[0-9a-f]{1,4}:/i);
  });
});
