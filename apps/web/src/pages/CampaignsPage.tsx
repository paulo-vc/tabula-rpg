import { roleOf } from '@tabula/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import { DoorOpenIcon, PlusIcon, UsersIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Link, useLocation } from 'wouter';
import { INVITE_ROUTE, decodeInvite, encodeInvite } from '@/app/invite-link';
import { useServices } from '@/app/services-context';
import { useDeviceId, useDisplayName } from '@/components/use-device';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export function CampaignsPage() {
  const { campaignRepository } = useServices();
  const campaigns = useLiveQuery(() => campaignRepository.list(), [campaignRepository]);
  const deviceId = useDeviceId();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Campanhas</h1>
        <div className="flex gap-2">
          <JoinDialog />
          <NewCampaignDialog />
        </div>
      </div>

      {campaigns?.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <UsersIcon className="text-muted-foreground size-10" />
          <p className="text-muted-foreground max-w-md">
            Crie uma campanha para mestrar, ou entre na de alguém com o convite que o Mestre enviou.
          </p>
        </div>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {campaigns?.map((campaign) => (
          <li key={campaign.id}>
            <Link
              href={`/campanhas/${campaign.id}`}
              className="block rounded-xl focus-visible:outline-2"
            >
              <Card className="hover:border-primary/50 h-full transition-colors">
                <CardHeader>
                  <CardTitle>{campaign.name}</CardTitle>
                  <CardDescription>
                    {campaign.templateName}
                    <br />
                    Mestre: {campaign.gmName}
                  </CardDescription>
                  {deviceId && (
                    <CardAction>
                      <Badge
                        variant={roleOf(campaign, deviceId) === 'mestre' ? 'default' : 'secondary'}
                      >
                        {roleOf(campaign, deviceId) === 'mestre' ? 'Mestre' : 'Jogador'}
                      </Badge>
                    </CardAction>
                  )}
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewCampaignDialog() {
  const { catalog, campaigns } = useServices();
  const templates = useLiveQuery(() => catalog.list(), [catalog]);
  const savedName = useDisplayName();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  // `null` enquanto o usuário não digitou: mostra o último nome usado.
  const [typedGmName, setGmName] = useState<string | null>(null);
  const gmName = typedGmName ?? savedName ?? '';
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = templateId || templates?.[0]?.id || '';
  const canCreate = name.trim() !== '' && gmName.trim() !== '' && selected !== '' && !busy;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    try {
      const campaign = await campaigns.create({ name, templateId: selected, gmName });
      setOpen(false);
      setName('');
      navigate(`/campanhas/${campaign.id}`);
    } catch (error) {
      toast.error('Não foi possível criar a campanha', { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon /> Nova campanha
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nova campanha</DialogTitle>
            <DialogDescription>
              Você será o Mestre. Todas as fichas da campanha usarão o sistema escolhido.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="campanha-nome">Nome da campanha</Label>
            <Input
              id="campanha-nome"
              value={name}
              maxLength={100}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="campanha-sistema">Sistema</Label>
            <Select value={selected} onValueChange={setTemplateId}>
              <SelectTrigger id="campanha-sistema" className="w-full">
                <SelectValue placeholder="Escolha um sistema" />
              </SelectTrigger>
              <SelectContent>
                {templates?.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="campanha-mestre">Seu nome (como os jogadores verão)</Label>
            <Input
              id="campanha-mestre"
              value={gmName}
              maxLength={100}
              onChange={(e) => setGmName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!canCreate}>
              Criar campanha
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function JoinDialog() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const decoded = decodeInvite(text);
    if (!decoded.ok) {
      setError(decoded.error.message);
      return;
    }
    setOpen(false);
    setText('');
    navigate(`${INVITE_ROUTE}${encodeInvite(decoded.value)}`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <DoorOpenIcon /> Entrar com convite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Entrar com convite</DialogTitle>
            <DialogDescription>Cole o link ou o código que o Mestre enviou.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="convite-texto">Convite</Label>
            <Textarea
              id="convite-texto"
              value={text}
              rows={4}
              autoFocus
              // Links não têm espaços: sem isso a caixa cresceria na horizontal para fora da tela.
              className="field-sizing-fixed break-all"
              aria-invalid={error !== null}
              aria-describedby={error ? 'convite-erro' : undefined}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
            />
            {error && (
              <p id="convite-erro" className="text-destructive text-sm">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={text.trim() === ''}>
              Continuar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
