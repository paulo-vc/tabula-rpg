import { describeRoll, type ChatMessage, type RollEntry } from '@tabula/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import { DicesIcon, EyeOffIcon, MessageCircleIcon, SendIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { LiveSession } from '@/app/live-session';
import { useServices } from '@/app/services-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLiveSession } from './use-live-session';

/** Quantos itens (mensagens e rolagens) o chat mostra (o registro guarda mais). */
const SHOWN = 100;

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

type Item = { kind: 'chat'; message: ChatMessage } | { kind: 'rolagem'; roll: RollEntry };

const atOf = (item: Item) => (item.kind === 'chat' ? item.message.at : item.roll.at);

/** Pessoa a quem dá para sussurrar. */
interface Recipient {
  id: string;
  name: string;
}

/**
 * Chat da sessão, em qualquer tela do app: um botão no canto abre o painel. As rolagens da
 * mesa aparecem no meio da conversa. Fora da sessão, não aparece.
 */
export function ChatDock() {
  const live = useLiveSession();
  if (live.kind === 'nenhuma') return null;
  return <Dock live={live} key={live.campaignId} />;
}

function Dock({ live }: { live: Exclude<LiveSession, { kind: 'nenhuma' }> }) {
  const { session } = useServices();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  // Com o chat fechado, conta as novidades (e avisa dos sussurros).
  useEffect(() => {
    if (open) return;
    return session.onChat((message) => {
      setUnread((count) => count + 1);
      if (message.to !== undefined) {
        toast(`Sussurro de ${message.authorName}`, { description: message.text });
      }
    });
  }, [session, open]);

  if (!open) {
    return (
      <Button
        className="fixed right-4 bottom-4 z-40 shadow-lg"
        aria-label={unread > 0 ? `Abrir chat (${unread} novas)` : 'Abrir chat'}
        onClick={() => {
          setOpen(true);
          setUnread(0);
        }}
      >
        <MessageCircleIcon /> Chat
        {unread > 0 && (
          <Badge variant="secondary" className="ml-1 tabular-nums">
            {unread}
          </Badge>
        )}
      </Button>
    );
  }
  return <ChatPanel live={live} onClose={() => setOpen(false)} />;
}

function ChatPanel({
  live,
  onClose,
}: {
  live: Exclude<LiveSession, { kind: 'nenhuma' }>;
  onClose: () => void;
}) {
  const { session, campaignRepository, sheetRepository } = useServices();
  const base = useId();
  const { campaignId } = live;
  const isGameMaster = live.kind === 'mestre';
  const messages = useLiveQuery(() => session.chat(campaignId), [session, campaignId]);
  const rolls = useLiveQuery(() => session.rolls(campaignId), [session, campaignId]);
  const campaign = useLiveQuery(
    () => campaignRepository.get(campaignId),
    [campaignRepository, campaignId],
  );
  const sheetId = live.kind === 'jogador' ? live.sheetId : null;
  const characterName = useLiveQuery(
    async () => (sheetId ? (await sheetRepository.get(sheetId))?.name : undefined),
    [sheetRepository, sheetId],
  );

  const [text, setText] = useState('');
  /** Jogador: falar como o personagem. Mestre: nome do NPC (vazio fala como Mestre). */
  const [asCharacter, setAsCharacter] = useState(false);
  const [npc, setNpc] = useState('');
  const [to, setTo] = useState('');

  const recipients: Recipient[] = useMemo(() => {
    if (live.kind === 'mestre') {
      return live.players
        .filter((player) => player.online)
        .map((player) => ({ id: player.userId, name: player.displayName }));
    }
    return campaign ? [{ id: campaign.gmId, name: campaign.gmName }] : [];
  }, [live, campaign]);
  const recipient = recipients.find((r) => r.id === to);

  const items = useMemo(() => {
    const all: Item[] = [
      ...(messages ?? []).map((message): Item => ({ kind: 'chat', message })),
      ...(rolls ?? []).map((roll): Item => ({ kind: 'rolagem', roll })),
    ];
    return all.sort((a, b) => atOf(a) - atOf(b)).slice(-SHOWN);
  }, [messages, rolls]);

  // Sempre mostra o mais recente.
  const feed = useRef<HTMLOListElement>(null);
  useEffect(() => {
    feed.current?.lastElementChild?.scrollIntoView?.({ block: 'end' });
  }, [items.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const character = isGameMaster ? npc.trim() : asCharacter ? characterName : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (text.trim() === '') return;
    // Limpa já: quem digita a próxima mensagem durante o envio não a perde.
    const sent = text;
    setText('');
    const result = await session.say({
      text: sent,
      ...(character && { character }),
      ...(recipient && { to: recipient }),
    });
    if (!result.ok) {
      toast.error('Não foi possível enviar', { description: result.error.message });
      setText((current) => (current === '' ? sent : current));
    }
  };

  const connected = live.kind === 'mestre' || live.status.state === 'conectado';

  return (
    <section
      aria-label="Chat da sessão"
      className="bg-background fixed right-4 bottom-4 z-40 flex h-[min(34rem,calc(100dvh-6rem))] w-[min(26rem,calc(100vw-2rem))] flex-col rounded-xl border shadow-xl"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <MessageCircleIcon className="size-4" />
        <h2 className="text-sm font-semibold">Chat da sessão</h2>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-8"
          aria-label="Fechar chat"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>

      {items.length === 0 ? (
        <p className="text-muted-foreground flex-1 p-4 text-sm">
          Nada por aqui ainda. Escreva para a mesa, use <code>/me</code> para descrever uma ação ou{' '}
          <code>/r 1d20+3</code> para rolar.
        </p>
      ) : (
        <ol
          ref={feed}
          aria-label="Mensagens do chat"
          className="flex-1 space-y-2 overflow-y-auto p-3"
        >
          {items.map((item) =>
            item.kind === 'chat' ? (
              <ChatLine
                key={`m-${item.message.id}`}
                message={item.message}
                mine={item.message.authorId === myId(live, campaign?.gmId)}
              />
            ) : (
              <RollLine key={`r-${item.roll.id}`} roll={item.roll} />
            ),
          )}
        </ol>
      )}

      <form onSubmit={submit} className="space-y-2 border-t p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {isGameMaster ? (
            <div className="flex items-center gap-1.5">
              <Label htmlFor={`${base}-npc`} className="text-xs font-normal">
                Falar como
              </Label>
              <Input
                id={`${base}-npc`}
                value={npc}
                maxLength={100}
                placeholder="Mestre"
                className="h-7 w-32 text-xs"
                onChange={(event) => setNpc(event.target.value)}
              />
            </div>
          ) : (
            characterName && (
              <Button
                type="button"
                size="sm"
                variant={asCharacter ? 'secondary' : 'ghost'}
                aria-pressed={asCharacter}
                className="h-7 text-xs"
                onClick={() => setAsCharacter((value) => !value)}
              >
                Como {characterName}
              </Button>
            )
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Label htmlFor={`${base}-para`} className="text-xs font-normal">
              Para
            </Label>
            <select
              id={`${base}-para`}
              value={recipient ? to : ''}
              onChange={(event) => setTo(event.target.value)}
              className="border-input dark:bg-input/30 h-7 rounded-md border bg-transparent px-2 text-xs"
            >
              <option value="">A mesa</option>
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>
                  Sussurro: {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <Label htmlFor={`${base}-texto`} className="sr-only">
            Mensagem
          </Label>
          <Input
            id={`${base}-texto`}
            value={text}
            maxLength={1000}
            autoFocus
            autoComplete="off"
            disabled={!connected}
            placeholder={
              connected
                ? recipient
                  ? `Sussurrar para ${recipient.name}…`
                  : 'Mensagem, /me ação ou /r 1d20'
                : 'Aguardando o Mestre…'
            }
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" size="icon" aria-label="Enviar" disabled={!connected}>
            <SendIcon />
          </Button>
        </div>
      </form>
    </section>
  );
}

/** ID de quem usa este aparelho na sessão (o jogador, ou o Mestre da campanha). */
function myId(live: Exclude<LiveSession, { kind: 'nenhuma' }>, gmId: string | undefined) {
  return live.kind === 'jogador' ? live.userId : gmId;
}

function ChatLine({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const whisper = message.to !== undefined;
  const speaker = message.character ?? message.authorName;
  return (
    <li
      className={cn(
        'rounded-md px-3 py-1.5 text-sm',
        whisper ? 'bg-violet-500/10 ring-1 ring-violet-500/30' : 'bg-muted/50',
      )}
    >
      <p className="text-muted-foreground flex items-baseline gap-2 text-xs">
        {whisper && (
          <span className="font-medium text-violet-600 dark:text-violet-400">
            {mine ? `Sussurro para ${message.toName}` : 'Sussurro'}
          </span>
        )}
        <time className="ml-auto" dateTime={new Date(message.at).toISOString()}>
          {time.format(message.at)}
        </time>
      </p>
      {message.kind === 'acao' ? (
        <p className="italic">
          <span className="font-medium">{speaker}</span> {message.text}
          {message.character && <Author name={message.authorName} />}
        </p>
      ) : (
        <p className="break-words whitespace-pre-wrap">
          <span className="font-medium">{speaker}</span>
          {message.character && <Author name={message.authorName} />}:{' '}
          {message.kind === 'personagem' ? <q>{message.text}</q> : message.text}
        </p>
      )}
    </li>
  );
}

/** Quem está por trás do personagem (ou do NPC). */
const Author = ({ name }: { name: string }) => (
  <span className="text-muted-foreground text-xs not-italic"> ({name})</span>
);

function RollLine({ roll }: { roll: RollEntry }) {
  return (
    <li className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
      <DicesIcon className="text-muted-foreground size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <span className="font-medium">{roll.authorName}</span>
          {roll.label && <span className="text-muted-foreground"> · {roll.label}</span>}
          {roll.secret && (
            <Badge variant="outline" className="ml-2">
              <EyeOffIcon /> Secreta
            </Badge>
          )}
        </p>
        <p className="text-muted-foreground truncate font-mono text-xs">
          {describeRoll(roll.result)}
        </p>
      </div>
      <span className="text-lg font-bold tabular-nums">{roll.result.total}</span>
    </li>
  );
}
