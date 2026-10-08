import { describeRoll } from '@tabula/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import { DicesIcon, EyeOffIcon } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useServices } from '@/app/services-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Quantas rolagens o painel mostra (o registro guarda mais). */
const SHOWN = 30;

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Registro de rolagens da campanha, com uma rolagem livre. O Mestre pode rolar em segredo
 * (só ele vê). Rolar fora da sessão aberta não entra no registro.
 */
export function RollLog({
  campaignId,
  isGameMaster,
}: {
  campaignId: string;
  isGameMaster: boolean;
}) {
  const { session } = useServices();
  const base = useId();
  const rolls = useLiveQuery(() => session.rolls(campaignId), [session, campaignId]);
  const [expression, setExpression] = useState('1d20');
  const [secret, setSecret] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await session.roll({ label: '', expression, secret: isGameMaster && secret });
    if (!result.ok) {
      toast.error('Não foi possível rolar', { description: result.error.message });
      return;
    }
    toast(`${expression}: ${result.value.result.total}`, {
      description: describeRoll(result.value.result),
    });
  };

  const recent = [...(rolls ?? [])].reverse().slice(0, SHOWN);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DicesIcon className="size-5" /> Rolagens
        </CardTitle>
        <CardDescription>
          As rolagens feitas durante a sessão aparecem para toda a mesa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${base}-dados`}>Rolagem livre</Label>
            <Input
              id={`${base}-dados`}
              value={expression}
              maxLength={100}
              className="w-40 font-mono"
              onChange={(event) => setExpression(event.target.value)}
            />
          </div>
          <Button type="submit">
            <DicesIcon /> Rolar
          </Button>
          {isGameMaster && (
            <div className="flex h-9 items-center gap-2">
              <Checkbox
                id={`${base}-secreta`}
                checked={secret}
                onCheckedChange={(checked) => setSecret(checked === true)}
              />
              <Label htmlFor={`${base}-secreta`} className="font-normal">
                Secreta
              </Label>
            </div>
          )}
        </form>

        {recent.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma rolagem ainda.</p>
        ) : (
          <ol className="space-y-2" aria-label="Registro de rolagens">
            {recent.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 rounded-md border px-3 py-2">
                <span className="w-10 shrink-0 text-center text-xl font-bold tabular-nums">
                  {entry.result.total}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate">
                    <span className="font-medium">{entry.authorName}</span>
                    {entry.label && <span className="text-muted-foreground"> · {entry.label}</span>}
                    {entry.secret && (
                      <Badge variant="outline" className="ml-2">
                        <EyeOffIcon /> Secreta
                      </Badge>
                    )}
                  </p>
                  <p className="text-muted-foreground truncate font-mono text-xs">
                    {describeRoll(entry.result)}
                  </p>
                </div>
                <time
                  className="text-muted-foreground shrink-0 text-xs"
                  dateTime={new Date(entry.at).toISOString()}
                >
                  {time.format(entry.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
