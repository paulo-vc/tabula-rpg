import { describe, expect, it } from 'vitest';
import { describeConnection, describeDuration } from './connection';

describe('textos da conexão', () => {
  it('durações curtas com décimo, depois segundos e minutos', () => {
    expect(describeDuration(1840)).toBe('1,8 s');
    expect(describeDuration(9040)).toBe('9 s');
    expect(describeDuration(42_300)).toBe('42 s');
    expect(describeDuration(59_600)).toBe('1 min');
    expect(describeDuration(119_600)).toBe('2 min');
    expect(describeDuration(125_000)).toBe('2 min 5 s');
    expect(describeDuration(-50)).toBe('0 s');
  });

  it('caminho e latência', () => {
    expect(describeConnection({ path: 'direta', rttMs: 42 })).toBe('conexão direta · 42 ms');
    expect(describeConnection({ path: 'direta', rttMs: null })).toBe('conexão direta');
    expect(describeConnection({ path: 'retransmitida', rttMs: 180 })).toBe('via servidor · 180 ms');
  });
});
