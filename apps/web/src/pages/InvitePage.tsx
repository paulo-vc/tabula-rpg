import { useLiveQuery } from 'dexie-react-hooks';
import { TriangleAlertIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Link, useLocation } from 'wouter';
import { decodeInvite } from '@/app/invite-link';
import { useServices } from '@/app/services-context';
import { useDisplayName } from '@/components/use-device';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Página aberta pelo link de convite: mostra a campanha e confirma a entrada. */
export function InvitePage({ code }: { code: string }) {
  const { campaigns, campaignRepository } = useServices();
  const [, navigate] = useLocation();
  const decoded = decodeInvite(code);
  const campaignId = decoded.ok ? decoded.value.campaignId : '';
  const existing = useLiveQuery(
    async () => (campaignId ? ((await campaignRepository.get(campaignId)) ?? null) : null),
    [campaignRepository, campaignId],
  );
  const savedName = useDisplayName();
  // `null` enquanto o usuário não digitou: mostra o último nome usado.
  const [typedName, setName] = useState<string | null>(null);
  const name = typedName ?? savedName ?? '';
  const [busy, setBusy] = useState(false);

  if (!decoded.ok) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <TriangleAlertIcon className="text-muted-foreground mx-auto size-10" />
        <h1 className="text-xl font-semibold">Convite inválido</h1>
        <p className="text-muted-foreground">{decoded.error.message}</p>
        <Button variant="outline" asChild>
          <Link href="/campanhas">Ir para Campanhas</Link>
        </Button>
      </div>
    );
  }
  const invite = decoded.value;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const result = await campaigns.join(invite, name);
      if (!result.ok) {
        toast.error('Não foi possível entrar', { description: result.error.message });
        return;
      }
      navigate(`/campanhas/${result.value.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg py-8">
      <Card>
        <CardHeader>
          <CardDescription>Você foi convidado para a campanha</CardDescription>
          <CardTitle>
            <h1 className="text-2xl">{invite.name}</h1>
          </CardTitle>
          <CardDescription>
            Mestre: {invite.gmName} · Sistema: {invite.templateName}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {existing ? (
            <div className="space-y-3">
              <p className="text-muted-foreground">Esta campanha já está no seu dispositivo.</p>
              <Button asChild>
                <Link href={`/campanhas/${existing.id}`}>Abrir campanha</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="convite-nome">Seu nome (como o Mestre verá)</Label>
                <Input
                  id="convite-nome"
                  value={name}
                  maxLength={100}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={!name.trim() || busy || existing === undefined}>
                Entrar na campanha
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
