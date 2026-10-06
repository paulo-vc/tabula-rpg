import { inviteFor, linkedSheetId, roleOf, type Campaign } from '@tabula/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeftIcon,
  CopyIcon,
  FileUpIcon,
  LogOutIcon,
  ScrollTextIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Link, useLocation } from 'wouter';
import { encodeInvite } from '@/app/invite-link';
import { useServices } from '@/app/services-context';
import { useDeviceId } from '@/components/use-device';
import { GameMasterSession, PlayerSession } from '@/components/live/SessionPanels';
import { useImport } from '@/components/use-import';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { publicAppUrl } from '@/lib/public-url';

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copiado`);
  } catch {
    toast.error('Não foi possível copiar', {
      description: 'Selecione o texto e copie manualmente.',
    });
  }
}

export function CampaignPage({ id }: { id: string }) {
  const { campaignRepository } = useServices();
  const campaign = useLiveQuery(
    async () => (await campaignRepository.get(id)) ?? null,
    [campaignRepository, id],
  );
  const deviceId = useDeviceId();

  if (campaign === undefined || deviceId === undefined) return null;
  if (campaign === null) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <TriangleAlertIcon className="text-muted-foreground mx-auto size-10" />
        <h1 className="text-xl font-semibold">Campanha não encontrada</h1>
        <Button variant="outline" asChild>
          <Link href="/campanhas">Voltar às campanhas</Link>
        </Button>
      </div>
    );
  }

  const role = roleOf(campaign, deviceId);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/campanhas" aria-label="Voltar às campanhas">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
        <Badge variant="secondary">{campaign.templateName}</Badge>
        <Badge>{role === 'mestre' ? 'Você é o Mestre' : `Mestre: ${campaign.gmName}`}</Badge>
      </div>
      {role === 'mestre' ? (
        <GameMasterView campaign={campaign} />
      ) : (
        <PlayerView campaign={campaign} userId={deviceId} />
      )}
    </div>
  );
}

function GameMasterView({ campaign }: { campaign: Campaign }) {
  const { campaigns } = useServices();
  const baseUrl = publicAppUrl();
  const code = encodeInvite(inviteFor(campaign));
  const link = baseUrl ? campaigns.inviteLink(campaign, baseUrl) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Convidar jogadores</h2>
          </CardTitle>
          <CardDescription>
            Envie o convite pelo chat do grupo. Quem tiver o convite entra na mesa: compartilhe só
            com seus jogadores.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {link && (
            <div className="space-y-2">
              <Label htmlFor="convite-link">Link</Label>
              <div className="flex gap-2">
                <Input id="convite-link" readOnly value={link} onFocus={(e) => e.target.select()} />
                <Button type="button" onClick={() => copy(link, 'Link')}>
                  <CopyIcon /> Copiar
                </Button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="convite-codigo">{link ? 'Ou só o código' : 'Código do convite'}</Label>
            <div className="flex gap-2">
              <Input
                id="convite-codigo"
                readOnly
                value={code}
                className="font-mono"
                onFocus={(e) => e.target.select()}
              />
              <Button
                type="button"
                variant={link ? 'outline' : 'default'}
                onClick={() => copy(code, 'Código')}
              >
                <CopyIcon /> Copiar
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              O jogador cola o código em Campanhas → Entrar com convite.
            </p>
          </div>
        </CardContent>
      </Card>

      <GameMasterSession campaign={campaign} />

      <DangerZone
        campaign={campaign}
        title="Excluir campanha"
        description="A campanha será apagada deste dispositivo. As fichas não são apagadas."
        action="Excluir"
        icon={<Trash2Icon />}
      />
    </div>
  );
}

function PlayerView({ campaign, userId }: { campaign: Campaign; userId: string }) {
  const { campaigns, catalog, sheetRepository } = useServices();
  const sheetId = linkedSheetId(campaign, userId);
  const linked = useLiveQuery(
    async () => (sheetId ? ((await sheetRepository.get(sheetId)) ?? null) : null),
    [sheetRepository, sheetId],
  );
  const compatible = useLiveQuery(
    () => campaigns.compatibleSheets(campaign),
    [campaigns, campaign],
  );
  const hasTemplate = useLiveQuery(
    async () => Boolean(await catalog.get(campaign.templateRef.id)),
    [catalog, campaign.templateRef.id],
  );
  const [choosing, setChoosing] = useState(false);
  const importFile = useImport();

  // `null`: sem ficha vinculada (ou a vinculada foi apagada). `undefined`: carregando.
  const showChooser = choosing || linked === null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Sua ficha</h2>
          </CardTitle>
          <CardDescription>
            O Mestre acompanhará esta ficha durante a sessão. Ela precisa ser do sistema{' '}
            <strong>{campaign.templateName}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {linked && !choosing && (
            <div className="flex flex-wrap items-center gap-2">
              <ScrollTextIcon className="text-muted-foreground size-5" />
              <span className="font-medium">{linked.name}</span>
              <Button size="sm" asChild>
                <Link href={`/fichas/${linked.id}`}>Abrir ficha</Link>
              </Button>
              <Button size="sm" variant="outline" onClick={() => setChoosing(true)}>
                Trocar
              </Button>
            </div>
          )}
          {sheetId && linked === null && !choosing && (
            <p className="text-destructive text-sm">
              A ficha vinculada não existe mais neste dispositivo. Escolha outra.
            </p>
          )}

          {showChooser && (
            <SheetChooser
              campaign={campaign}
              compatible={compatible ?? []}
              hasTemplate={hasTemplate ?? true}
              onDone={() => setChoosing(false)}
              onImport={importFile}
            />
          )}
        </CardContent>
      </Card>

      <PlayerSession campaign={campaign} hasSheet={Boolean(linked)} />

      <DangerZone
        campaign={campaign}
        title="Sair da campanha"
        description="A campanha sai deste dispositivo. Sua ficha continua em Minhas fichas."
        action="Sair"
        icon={<LogOutIcon />}
      />
    </div>
  );
}

function SheetChooser({
  campaign,
  compatible,
  hasTemplate,
  onDone,
  onImport,
}: {
  campaign: Campaign;
  compatible: { id: string; name: string }[];
  hasTemplate: boolean;
  onDone: () => void;
  onImport: () => void;
}) {
  const { campaigns } = useServices();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const link = async (sheetId: string) => {
    const result = await campaigns.linkSheet(campaign.id, sheetId);
    if (result.ok) onDone();
    else toast.error('Não foi possível vincular', { description: result.error.message });
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const result = await campaigns.createLinkedSheet(campaign.id, name);
      if (result.ok) {
        setName('');
        onDone();
      } else {
        toast.error('Não foi possível criar a ficha', { description: result.error.message });
      }
    } finally {
      setBusy(false);
    }
  };

  if (!hasTemplate) {
    return (
      <div className="space-y-2 text-sm">
        <p>
          O sistema <strong>{campaign.templateName}</strong> não está instalado neste dispositivo.
          Peça ao Mestre o arquivo do sistema (Sistemas → Exportar) e importe-o.
        </p>
        <Button variant="outline" size="sm" onClick={onImport}>
          <FileUpIcon /> Importar sistema
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {compatible.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Usar uma ficha que você já tem</p>
          <ul className="space-y-1">
            {compatible.map((sheet) => (
              <li
                key={sheet.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <span className="truncate">{sheet.name}</span>
                <Button size="sm" variant="outline" onClick={() => link(sheet.id)}>
                  Usar esta
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form onSubmit={create} className="space-y-2">
        <Label htmlFor="campanha-nova-ficha">
          {compatible.length > 0 ? 'Ou crie uma ficha nova' : 'Crie sua ficha'}
        </Label>
        <div className="flex gap-2">
          <Input
            id="campanha-nova-ficha"
            placeholder="Nome do personagem"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={!name.trim() || busy}>
            Criar
          </Button>
        </div>
      </form>
    </div>
  );
}

function DangerZone({
  campaign,
  title,
  description,
  action,
  icon,
}: {
  campaign: Campaign;
  title: string;
  description: string;
  action: string;
  icon: React.ReactNode;
}) {
  const { campaigns } = useServices();
  const [, navigate] = useLocation();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="lg:col-span-2">
      <Button variant="ghost" className="text-destructive" onClick={() => setConfirm(true)}>
        {icon} {title}
      </Button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {title}: "{campaign.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                await campaigns.delete(campaign.id);
                navigate('/campanhas');
              }}
            >
              {action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
