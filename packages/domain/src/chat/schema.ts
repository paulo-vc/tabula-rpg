import { z } from 'zod';
import { IdSchema, LabelSchema, TimestampSchema } from '../schema/primitives';

/** Tamanho máximo de uma mensagem do chat. */
export const CHAT_TEXT_LIMIT = 1000;
/** Quantas mensagens cada campanha guarda neste aparelho (as mais antigas saem). */
export const CHAT_LIMIT = 200;
/** Quantas mensagens recentes o Mestre envia a quem entra no meio da sessão. */
export const CHAT_CATCH_UP = 50;

/**
 * Como a mensagem é dita:
 * - `fala`: o jogador (ou o Mestre) falando, fora do personagem;
 * - `personagem`: fala do personagem (ou de um NPC, no caso do Mestre), com o nome em `character`;
 * - `acao`: descrição de uma ação ("saca a espada e avança"), do personagem se houver `character`.
 */
export const ChatKindSchema = z.enum(['fala', 'personagem', 'acao']);
export type ChatKind = z.infer<typeof ChatKindSchema>;

/**
 * Uma mensagem do chat da sessão. Vem de outros participantes: o formato é conferido, e o
 * Mestre só repassa mensagens do próprio autor. `to` é o sussurro: a mensagem só vai a essa
 * pessoa (hoje, entre o Mestre e um jogador).
 */
export const ChatMessageSchema = z
  .object({
    id: IdSchema,
    at: TimestampSchema,
    authorId: IdSchema,
    authorName: LabelSchema,
    kind: ChatKindSchema,
    /** Quem fala: obrigatório em `personagem`, opcional em `acao`, ausente em `fala`. */
    character: LabelSchema.optional(),
    text: z.string().trim().min(1).max(CHAT_TEXT_LIMIT),
    /** Sussurro: o ID de quem recebe, e o nome (para mostrar). */
    to: IdSchema.optional(),
    toName: LabelSchema.optional(),
  })
  .refine(
    (message) =>
      message.kind === 'acao' ||
      (message.kind === 'personagem') === (message.character !== undefined),
    { message: 'Fala de personagem precisa do nome do personagem', path: ['character'] },
  )
  .refine((message) => (message.to === undefined) === (message.toName === undefined), {
    message: 'Sussurro precisa de destinatário e nome',
    path: ['to'],
  })
  .refine((message) => message.to !== message.authorId, {
    message: 'Sussurro para si mesmo',
    path: ['to'],
  });
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Quem pode ver a mensagem: a mesa toda, ou só quem sussurrou e quem recebeu. */
export const canSee = (message: ChatMessage, userId: string): boolean =>
  message.to === undefined || message.to === userId || message.authorId === userId;

/**
 * O que foi digitado no chat:
 * - `/r 1d20+3 Ataque` (ou `/rolar`): rola dados, com um rótulo opcional;
 * - `/me saca a espada` (ou `/acao`): descreve uma ação;
 * - o resto é uma mensagem.
 */
export type ChatInput =
  | { kind: 'rolagem'; expression: string; label: string }
  | { kind: 'acao'; text: string }
  | { kind: 'mensagem'; text: string };

export function parseChatInput(raw: string): ChatInput | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  const command = /^\/(\S+)\s*([\s\S]*)$/.exec(text);
  const name = command?.[1]?.toLowerCase();
  const rest = command?.[2]?.trim() ?? '';
  if (name === 'r' || name === 'rolar') {
    // A expressão são as primeiras palavras feitas só de dados ("1d20 + 3"); o resto é o rótulo.
    const words = rest.split(/\s+/).filter(Boolean);
    const dice = words.findIndex((word) => !/^[0-9dkhl+-]+$/i.test(word));
    const cut = dice === -1 ? words.length : dice;
    if (cut === 0) return null;
    return {
      kind: 'rolagem',
      expression: words.slice(0, cut).join(''),
      label: words.slice(cut).join(' '),
    };
  }
  if (name === 'me' || name === 'acao' || name === 'ação') {
    return rest.length === 0 ? null : { kind: 'acao', text: rest };
  }
  return { kind: 'mensagem', text };
}
