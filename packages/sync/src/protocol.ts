import { IdSchema, LabelSchema } from '@tabula/domain';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { z } from 'zod';

/**
 * Protocolo da sessão (binário, com lib0):
 *
 *   HELLO   [0][json]                 apresentação (papel, usuário, ficha)
 *   SYNC    [1][sheetId][y-protocols] sincronização Yjs de UMA ficha
 *   REJECT  [2][json]                 o Mestre recusou o jogador (motivo)
 *
 * Topologia em estrela: jogadores só conversam com o Mestre; cada ficha é um documento
 * separado, sincronizado apenas entre o dono e o Mestre (jogadores não recebem as fichas
 * uns dos outros).
 */
export const PROTOCOL_VERSION = 1;

/** Mensagens maiores são descartadas (proteção contra participantes maliciosos). */
export const MAX_MESSAGE_BYTES = 512 * 1024;

const MessageType = { Hello: 0, Sync: 1, Reject: 2 } as const;

const base = {
  protocol: z.literal(PROTOCOL_VERSION),
  campaignId: IdSchema,
  userId: IdSchema,
  displayName: LabelSchema,
};

export const HelloSchema = z.discriminatedUnion('role', [
  z.object({ ...base, role: z.literal('mestre') }),
  z.object({ ...base, role: z.literal('jogador'), sheetId: IdSchema, templateId: IdSchema }),
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
  | { type: 'reject'; reject: Reject };

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
