import {
  CHAT_CATCH_UP,
  ChatMessageSchema,
  type ChatMessage,
  compileTemplate,
  CoverSchema,
  type Cover,
  GmKeySchema,
  IdSchema,
  LabelSchema,
  LOG_CATCH_UP,
  PublicTrackerSchema,
  CutsceneSchema,
  IMAGE_CHUNK_BYTES,
  ImageHashSchema,
  MAX_IMAGE_CHUNKS,
  type Cutscene,
  JOURNAL_SHARED_LIMIT,
  JournalEntrySchema,
  type JournalEntry,
  type PublicTracker,
  RollEntrySchema,
  type RollEntry,
  SystemTemplateSchema,
  type SystemTemplate,
} from '@tabula/domain';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { z } from 'zod';

/**
 * Protocolo da sessão (binário, com lib0):
 *
 *   HELLO   [0][json]                 apresentação (papel, usuário, ficha)
 *   SYNC    [1][sheetId][y-protocols] sincronização Yjs de UMA ficha
 *   REJECT  [2][json]                 o Mestre recusou o jogador (motivo)
 *   TEMPLATE_REQUEST [3][json]        pede o sistema da campanha ao Mestre
 *   TEMPLATE         [4][json]        o sistema (validado como um arquivo importado)
 *   LOG              [5][json]        rolagens do registro da sessão
 *   TURN             [6][json]        ordem de turno do combate (versão pública), ou nenhuma
 *   BYE              [7]              saí da sessão (a conexão pode continuar aberta)
 *   JOURNAL_PUT      [8][json]        entrada do diário compartilhada pelo Mestre
 *   JOURNAL_KEEP     [9][json]        entradas que continuam compartilhadas (apaga as outras)
 *   CUTSCENE         [10][json]       imagem que o Mestre mostra à mesa (ou nenhuma)
 *   IMAGE_REQUEST    [11][json]       o jogador pede a imagem que não tem
 *   IMAGE_PART       [12][hash][i][n][bytes]  uma parte da imagem (até 256 KB)
 *   CHAT             [13][json]       mensagens do chat (o Mestre repassa; sussurros só a quem recebe)
 *   COVER            [14][json]       capa da campanha (ou nenhuma), enviada pelo Mestre
 *
 * Topologia em estrela: jogadores só conversam com o Mestre; cada ficha é um documento
 * separado, sincronizado apenas entre o dono e o Mestre (jogadores não recebem as fichas
 * uns dos outros).
 */
export const PROTOCOL_VERSION = 1;

/** Mensagens maiores são descartadas (proteção contra participantes maliciosos). */
export const MAX_MESSAGE_BYTES = 512 * 1024;

const MessageType = {
  Hello: 0,
  Sync: 1,
  Reject: 2,
  TemplateRequest: 3,
  Template: 4,
  Log: 5,
  Turn: 6,
  Bye: 7,
  JournalPut: 8,
  JournalKeep: 9,
  Cutscene: 10,
  ImageRequest: 11,
  ImagePart: 12,
  Chat: 13,
  Cover: 14,
} as const;

const base = {
  protocol: z.literal(PROTOCOL_VERSION),
  campaignId: IdSchema,
  userId: IdSchema,
  displayName: LabelSchema,
};

/** Desafio do jogador (128 bits, base64url) e prova do Mestre (assinatura Ed25519). */
const ChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const ProofSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/);

/**
 * Identidade do Mestre: o jogador manda um `challenge` aleatório; o Mestre responde com a
 * chave pública (`gmKey`) e a assinatura do desafio (`proof`). Os campos são opcionais para
 * continuar falando com a v0.1, que não os conhece (e ignora).
 */
export const HelloSchema = z.discriminatedUnion('role', [
  z.object({
    ...base,
    role: z.literal('mestre'),
    gmKey: GmKeySchema.optional(),
    proof: ProofSchema.optional(),
  }),
  z.object({
    ...base,
    role: z.literal('jogador'),
    sheetId: IdSchema,
    templateId: IdSchema,
    challenge: ChallengeSchema.optional(),
  }),
]);
export type Hello = z.infer<typeof HelloSchema>;

export const RejectSchema = z.object({
  code: z.enum([
    'sistema-diferente',
    'ficha-de-outro',
    'campanha-diferente',
    'sala-cheia',
    'versao-incompativel',
  ]),
  message: z.string().max(500),
});
export type Reject = z.infer<typeof RejectSchema>;

export type IncomingMessage =
  | { type: 'hello'; hello: Hello }
  | { type: 'sync'; sheetId: string; decoder: decoding.Decoder }
  | { type: 'reject'; reject: Reject }
  | { type: 'template-request'; request: TemplateRequest }
  | { type: 'template'; template: SystemTemplate }
  | { type: 'log'; entries: RollEntry[] }
  | { type: 'turn'; tracker: PublicTracker | null }
  | { type: 'bye' }
  | { type: 'journal-put'; entry: JournalEntry }
  | { type: 'journal-keep'; ids: string[] }
  | { type: 'cutscene'; cutscene: Cutscene | null }
  | { type: 'image-request'; hash: string }
  | { type: 'image-part'; hash: string; index: number; total: number; data: Uint8Array }
  | { type: 'chat'; messages: ChatMessage[] }
  | { type: 'cover'; cover: Cover | null };

const LogSchema = z.object({ entries: z.array(RollEntrySchema).min(1).max(LOG_CATCH_UP) });

export function encodeLog(entries: RollEntry[]): Uint8Array {
  return encodeJson(MessageType.Log, { entries });
}

const ChatSchema = z.object({ messages: z.array(ChatMessageSchema).min(1).max(CHAT_CATCH_UP) });

const CoverMessageSchema = z.object({ cover: CoverSchema.nullable() });

export function encodeCover(cover: Cover | null): Uint8Array {
  return encodeJson(MessageType.Cover, { cover });
}

export function encodeChat(messages: readonly ChatMessage[]): Uint8Array {
  return encodeJson(MessageType.Chat, { messages });
}

/** Ordem de turno: só a versão pública (sem os ocultos) sai do aparelho do Mestre. */
const TurnSchema = z.object({ tracker: PublicTrackerSchema.nullable() });

/**
 * Saí da sessão. A conexão WebRTC pode continuar aberta (o app mantém a sala para entrar de
 * novo na hora), então a saída precisa ser avisada. Versões antigas ignoram a mensagem.
 */
export function encodeBye(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Bye);
  return encoding.toUint8Array(encoder);
}

// Só entradas compartilhadas viajam: notas do Mestre (shared: false) nunca saem do aparelho.
const JournalPutSchema = z.object({
  entry: JournalEntrySchema.refine((entry) => entry.shared, 'Entrada não compartilhada'),
});
const JournalKeepSchema = z.object({ ids: z.array(IdSchema).max(JOURNAL_SHARED_LIMIT) });

export function encodeJournalPut(entry: JournalEntry): Uint8Array {
  return encodeJson(MessageType.JournalPut, { entry });
}

export function encodeJournalKeep(ids: readonly string[]): Uint8Array {
  return encodeJson(MessageType.JournalKeep, { ids });
}

const CutsceneMessageSchema = z.object({ cutscene: CutsceneSchema.nullable() });
const ImageRequestSchema = z.object({ hash: ImageHashSchema });

export function encodeCutscene(cutscene: Cutscene | null): Uint8Array {
  return encodeJson(MessageType.Cutscene, { cutscene });
}

export function encodeImageRequest(hash: string): Uint8Array {
  return encodeJson(MessageType.ImageRequest, { hash });
}

/** Uma parte da imagem, em binário (sem JSON nem base64). */
export function encodeImagePart(
  hash: string,
  index: number,
  total: number,
  data: Uint8Array,
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.ImagePart);
  encoding.writeVarString(encoder, hash);
  encoding.writeVarUint(encoder, index);
  encoding.writeVarUint(encoder, total);
  encoding.writeVarUint8Array(encoder, data);
  return encoding.toUint8Array(encoder);
}

export function encodeTurn(tracker: PublicTracker | null): Uint8Array {
  return encodeJson(MessageType.Turn, { tracker });
}

/** Pedido do sistema da campanha (quem ainda não o tem instalado, nem ficha). */
export const TemplateRequestSchema = z.object({
  protocol: z.literal(PROTOCOL_VERSION),
  campaignId: IdSchema,
  templateId: IdSchema,
});
export type TemplateRequest = z.infer<typeof TemplateRequestSchema>;

export function encodeTemplateRequest(request: TemplateRequest): Uint8Array {
  return encodeJson(MessageType.TemplateRequest, request);
}

export function encodeTemplate(template: SystemTemplate): Uint8Array {
  return encodeJson(MessageType.Template, template);
}

function encodeJson(type: number, value: unknown): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  encoding.writeVarString(encoder, JSON.stringify(value));
  return encoding.toUint8Array(encoder);
}

export function encodeHello(hello: Hello): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Hello);
  encoding.writeVarString(encoder, JSON.stringify(hello));
  return encoding.toUint8Array(encoder);
}

export function encodeReject(reject: Reject): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Reject);
  encoding.writeVarString(encoder, JSON.stringify(reject));
  return encoding.toUint8Array(encoder);
}

/** Começa uma mensagem SYNC; o chamador escreve o conteúdo do y-protocols em seguida. */
export function syncEncoder(sheetId: string): encoding.Encoder {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Sync);
  encoding.writeVarString(encoder, sheetId);
  return encoder;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * Decodifica uma mensagem recebida. Qualquer coisa malformada, grande demais ou fora do
 * schema devolve `null` (e é ignorada): nunca lança exceção por causa do conteúdo.
 */
export function decodeMessage(data: Uint8Array): IncomingMessage | null {
  if (data.byteLength === 0 || data.byteLength > MAX_MESSAGE_BYTES) return null;
  try {
    const decoder = decoding.createDecoder(data);
    switch (decoding.readVarUint(decoder)) {
      case MessageType.TemplateRequest: {
        const request = TemplateRequestSchema.safeParse(parseJson(decoding.readVarString(decoder)));
        return request.success ? { type: 'template-request', request: request.data } : null;
      }
      case MessageType.Template: {
        // Vem de outro participante: mesma validação de um arquivo importado (schema e regras).
        const template = SystemTemplateSchema.safeParse(parseJson(decoding.readVarString(decoder)));
        if (!template.success || !compileTemplate(template.data).ok) return null;
        return { type: 'template', template: template.data };
      }
      case MessageType.Log: {
        const log = LogSchema.safeParse(parseJson(decoding.readVarString(decoder)));
        return log.success ? { type: 'log', entries: log.data.entries } : null;
      }
      case MessageType.Bye:
        return { type: 'bye' };
      case MessageType.Cover: {
        const message = CoverMessageSchema.safeParse(parseJson(decoding.readVarString(decoder)));
        return message.success ? { type: 'cover', cover: message.data.cover } : null;
      }
      case MessageType.Chat: {
        const chat = ChatSchema.safeParse(parseJson(decoding.readVarString(decoder)));
        return chat.success ? { type: 'chat', messages: chat.data.messages } : null;
      }
      case MessageType.Cutscene: {
        const message = CutsceneMessageSchema.safeParse(parseJson(decoding.readVarString(decoder)));
        return message.success ? { type: 'cutscene', cutscene: message.data.cutscene } : null;
      }
      case MessageType.ImageRequest: {
        const request = ImageRequestSchema.safeParse(parseJson(decoding.readVarString(decoder)));
        return request.success ? { type: 'image-request', hash: request.data.hash } : null;
      }
      case MessageType.ImagePart: {
        const hash = ImageHashSchema.safeParse(decoding.readVarString(decoder));
        const index = decoding.readVarUint(decoder);
        const total = decoding.readVarUint(decoder);
        const data = decoding.readVarUint8Array(decoder);
        if (!hash.success || total < 1 || total > MAX_IMAGE_CHUNKS || index >= total) return null;
        if (data.byteLength < 1 || data.byteLength > IMAGE_CHUNK_BYTES) return null;
        return { type: 'image-part', hash: hash.data, index, total, data };
      }
      case MessageType.JournalPut: {
        const put = JournalPutSchema.safeParse(parseJson(decoding.readVarString(decoder)));
        return put.success ? { type: 'journal-put', entry: put.data.entry } : null;
      }
      case MessageType.JournalKeep: {
        const keep = JournalKeepSchema.safeParse(parseJson(decoding.readVarString(decoder)));
        return keep.success ? { type: 'journal-keep', ids: keep.data.ids } : null;
      }
      case MessageType.Turn: {
        const turn = TurnSchema.safeParse(parseJson(decoding.readVarString(decoder)));
        return turn.success ? { type: 'turn', tracker: turn.data.tracker } : null;
      }
      case MessageType.Hello: {
        const hello = HelloSchema.safeParse(parseJson(decoding.readVarString(decoder)));
        return hello.success ? { type: 'hello', hello: hello.data } : null;
      }
      case MessageType.Sync: {
        const sheetId = IdSchema.safeParse(decoding.readVarString(decoder));
        return sheetId.success ? { type: 'sync', sheetId: sheetId.data, decoder } : null;
      }
      case MessageType.Reject: {
        const reject = RejectSchema.safeParse(parseJson(decoding.readVarString(decoder)));
        return reject.success ? { type: 'reject', reject: reject.data } : null;
      }
      default:
        return null;
    }
  } catch {
    return null; // bytes truncados ou inválidos
  }
}
