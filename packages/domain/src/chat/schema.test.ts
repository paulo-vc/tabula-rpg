import { describe, expect, it } from 'vitest';
import { parseDice } from '../dice/dice';
import {
  canSee,
  CHAT_TEXT_LIMIT,
  ChatMessageSchema,
  parseChatInput,
  type ChatMessage,
} from './schema';

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  at: 1,
  authorId: 'ana',
  authorName: 'Ana',
  kind: 'fala',
  text: 'Olá, mesa!',
  ...overrides,
});

describe('ChatMessageSchema', () => {
  it('aceita fala, fala de personagem, ação e sussurro', () => {
    expect(ChatMessageSchema.safeParse(message()).success).toBe(true);
    expect(
      ChatMessageSchema.safeParse(message({ kind: 'personagem', character: 'Lia' })).success,
    ).toBe(true);
    expect(ChatMessageSchema.safeParse(message({ kind: 'acao' })).success).toBe(true);
    expect(ChatMessageSchema.safeParse(message({ to: 'mestre', toName: 'Paulo' })).success).toBe(
      true,
    );
  });

  it('recusa texto vazio ou longo demais', () => {
    expect(ChatMessageSchema.safeParse(message({ text: '   ' })).success).toBe(false);
    const long = 'a'.repeat(CHAT_TEXT_LIMIT + 1);
    expect(ChatMessageSchema.safeParse(message({ text: long })).success).toBe(false);
  });

  it('fala de personagem precisa do nome; a ação pode ter; a fala comum, não', () => {
    expect(ChatMessageSchema.safeParse(message({ kind: 'personagem' })).success).toBe(false);
    expect(ChatMessageSchema.safeParse(message({ character: 'Lia' })).success).toBe(false);
    expect(ChatMessageSchema.safeParse(message({ kind: 'acao', character: 'Lia' })).success).toBe(
      true,
    );
  });

  it('sussurro precisa de destinatário e nome, e não pode ser para si', () => {
    expect(ChatMessageSchema.safeParse(message({ to: 'mestre' })).success).toBe(false);
    expect(ChatMessageSchema.safeParse(message({ toName: 'Paulo' })).success).toBe(false);
    expect(ChatMessageSchema.safeParse(message({ to: 'ana', toName: 'Ana' })).success).toBe(false);
  });
});

describe('canSee', () => {
  it('a mesa vê tudo; o sussurro, só quem mandou e quem recebeu', () => {
    const whisper = message({ to: 'mestre', toName: 'Paulo' });
    expect(canSee(message(), 'bia')).toBe(true);
    expect(canSee(whisper, 'ana')).toBe(true);
    expect(canSee(whisper, 'mestre')).toBe(true);
    expect(canSee(whisper, 'bia')).toBe(false);
  });
});

describe('parseChatInput', () => {
  it('mensagem comum, sem o espaço em volta', () => {
    expect(parseChatInput('  Vamos pela mina?  ')).toEqual({
      kind: 'mensagem',
      text: 'Vamos pela mina?',
    });
    expect(parseChatInput('   ')).toBeNull();
  });

  it('/me e /acao descrevem uma ação', () => {
    expect(parseChatInput('/me saca a espada')).toEqual({ kind: 'acao', text: 'saca a espada' });
    expect(parseChatInput('/acao corre')).toEqual({ kind: 'acao', text: 'corre' });
    expect(parseChatInput('/me')).toBeNull();
  });

  it('/r rola dados, com rótulo opcional', () => {
    expect(parseChatInput('/r 1d20+3 Ataque')).toEqual({
      kind: 'rolagem',
      expression: '1d20+3',
      label: 'Ataque',
    });
    expect(parseChatInput('/rolar 2d6 + 1 dano de fogo')).toEqual({
      kind: 'rolagem',
      expression: '2d6+1',
      label: 'dano de fogo',
    });
    expect(parseChatInput('/r 4d6kh3')).toEqual({
      kind: 'rolagem',
      expression: '4d6kh3',
      label: '',
    });
    expect(parseChatInput('/r')).toBeNull();
    expect(parseChatInput('/r Ataque')).toBeNull();
  });

  it('a expressão separada é uma rolagem válida', () => {
    const input = parseChatInput('/r 1d20 + 5 Furtividade');
    expect(input?.kind).toBe('rolagem');
    if (input?.kind === 'rolagem') expect(parseDice(input.expression).ok).toBe(true);
  });

  it('outros comandos viram mensagem comum', () => {
    expect(parseChatInput('/shrug')).toEqual({ kind: 'mensagem', text: '/shrug' });
  });
});
