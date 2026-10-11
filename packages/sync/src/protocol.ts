import {
  compileTemplate,
  GmKeySchema,
  IdSchema,
  LabelSchema,
  LOG_CATCH_UP,
  PublicTrackerSchema,
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
  | { type: 'bye' };

const LogSchema = z.object({ entries: z.array(RollEntrySchema).min(1).max(LOG_CATCH_UP) });

export function encodeLog(entries: RollEntry[]): Uint8Array {
  return encodeJson(MessageType.Log, { entries });
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
