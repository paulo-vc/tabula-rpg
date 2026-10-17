import {
  computeDerived,
  initiativeExpression,
  linkedSheetId,
  roleOf,
  type Campaign,
} from '@tabula/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeftIcon,
  DownloadIcon,
  FileUpIcon,
  LoaderCircleIcon,
  LogOutIcon,
  ScrollTextIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Link } from 'wouter';
import { useServices } from '@/app/services-context';
import { useDeviceId } from '@/components/use-device';
import { CampaignCover } from '@/components/campaign/CampaignCover';
import { PlayerJournal } from '@/components/campaign/JournalPanel';
import { PlayerInitiative } from '@/components/live/InitiativePanel';
import { RollLog } from '@/components/live/RollLog';
import { PlayerSession } from '@/components/live/SessionPanels';
import { DangerZone } from '@/components/campaign/DangerZone';
import { GameMasterView } from '@/components/campaign/GameMasterView';
import { useImport } from '@/components/use-import';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
      <CampaignCover
        campaign={campaign}
        className={role === 'mestre' ? 'h-24 sm:h-32' : undefined}
      />
      {role === 'mestre' ? (
        <GameMasterView campaign={campaign} />
      ) : (
        <PlayerView campaign={campaign} userId={deviceId} />
      )}
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
  // Rolagem de iniciativa da ficha vinculada (ex.: "1d20+2"), se o sistema define uma.
  const linkedTemplate = useLiveQuery(
    async () => (linked ? await catalog.get(linked.templateRef.id) : undefined),
    [catalog, linked?.templateRef.id],
  );
  const initiativeRoll = useMemo(() => {
    if (!linked || !linkedTemplate) return null;
    const compiled = catalog.compile(linkedTemplate);
    return initiativeExpression(
      compiled,
      linked.values,
      computeDerived(compiled, linked.values, linked.bonuses),
    );
  }, [catalog, linked, linkedTemplate]);

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
      <PlayerInitiative campaignId={campaign.id} initiativeRoll={initiativeRoll} />
      <RollLog campaignId={campaign.id} isGameMaster={false} />
      <PlayerJournal campaignId={campaign.id} />

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

  if (!hasTemplate) return <MissingTemplate campaign={campaign} onImport={onImport} />;

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

const RECEIPT_FAILURE: Record<'mestre-ausente' | 'falha-de-conexao' | 'campanha-ausente', string> =
  {
    'mestre-ausente':
      'O Mestre não respondeu. Peça para ele abrir a sessão da campanha e tente de novo.',
    'falha-de-conexao':
      'A conexão direta com o Mestre não abriu (redes de empresa/escola ou 4G dos dois lados costumam bloquear). Tentem outra rede ou importe o arquivo do sistema.',
    'campanha-ausente': 'Campanha não encontrada.',
  };

/** O sistema da campanha não está instalado: recebe do Mestre (ou importa o arquivo). */
function MissingTemplate({ campaign, onImport }: { campaign: Campaign; onImport: () => void }) {
  const { session } = useServices();
  const [waiting, setWaiting] = useState<AbortController | null>(null);

  const receive = async () => {
    const controller = new AbortController();
    setWaiting(controller);
    try {
      const result = await session.receiveTemplate(campaign.id, controller.signal);
      if (result.ok) {
        toast.success(`Sistema "${campaign.templateName}" recebido do Mestre`);
      } else if ('reason' in result) {
        if (result.reason !== 'cancelado') {
          toast.error('Não foi possível receber o sistema', {
            description: RECEIPT_FAILURE[result.reason],
          });
        }
      } else {
        toast.error('Não foi possível instalar o sistema', {
          description: result.issues[0]?.message,
        });
      }
    } finally {
      setWaiting(null);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <p>
        O sistema <strong>{campaign.templateName}</strong> ainda não está neste dispositivo. Receba
        direto do Mestre enquanto a sessão dele estiver aberta.
      </p>
      {waiting ? (
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="text-muted-foreground flex items-center gap-2">
            <LoaderCircleIcon className="size-4 animate-spin" />
            Aguardando o Mestre…
          </span>
          <Button size="sm" variant="ghost" onClick={() => waiting.abort()}>
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={receive}>
            <DownloadIcon /> Receber do Mestre
          </Button>
          <Button variant="outline" size="sm" onClick={onImport}>
            <FileUpIcon /> Importar arquivo
          </Button>
        </div>
      )}
    </div>
  );
}
