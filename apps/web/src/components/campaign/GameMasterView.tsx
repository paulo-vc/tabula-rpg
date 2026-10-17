import { inviteFor, type Campaign } from '@tabula/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BookOpenIcon,
  CopyIcon,
  DicesIcon,
  ImageIcon,
  SettingsIcon,
  SwordsIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersIcon,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { encodeInvite } from '@/app/invite-link';
import { useServices } from '@/app/services-context';
import { CampaignCoverEditor } from '@/components/campaign/CampaignCover';
import { CutscenePanel } from '@/components/campaign/CutscenePanel';
import { DangerZone } from '@/components/campaign/DangerZone';
import { GameMasterJournal } from '@/components/campaign/JournalPanel';
import { GameMasterInitiative } from '@/components/live/InitiativePanel';
import { RollLog } from '@/components/live/RollLog';
import { GameMasterPlayers, GameMasterSessionBar } from '@/components/live/SessionPanels';
import { useLiveSession } from '@/components/live/use-live-session';
import { TabBar, type TabItem } from '@/components/TabBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { publicAppUrl } from '@/lib/public-url';

type Tab = 'jogadores' | 'combate' | 'rolagens' | 'cutscene' | 'diario' | 'campanha';

/** Abas que no computador ficam na coluna da direita (no celular, viram abas). */
const SIDE: readonly Tab[] = ['combate', 'rolagens'];

/**
 * Painel do Mestre. À esquerda, abas (jogadores, cutscene, diário, campanha); à direita, uma
 * coluna sempre à vista com o combate e as rolagens, para conduzir a cena sem trocar de aba.
 * No celular, o combate e as rolagens também viram abas.
 */
export function GameMasterView({ campaign }: { campaign: Campaign }) {
  const { catalog } = useServices();
  const live = useLiveSession();
  // Dado dos testes do sistema: o Mestre rola a iniciativa das criaturas com ele ("+3").
  const checkDice = useLiveQuery(
    async () => (await catalog.get(campaign.templateRef.id))?.checkDice,
    [catalog, campaign.templateRef.id],
  );
  const [tab, setTab] = useState<Tab>('jogadores');
  const active = live.kind === 'mestre' && live.campaignId === campaign.id;
  const online = active ? live.players.filter((p) => p.online).length : 0;
  const inCombat = active && live.initiative !== null;
  const side = SIDE.includes(tab);
  // No computador, as abas da direita não existem: o painel da esquerda mostra os jogadores.
  const main: Tab = side ? 'jogadores' : tab;

  const tabs: TabItem<Tab>[] = [
    {
      id: 'jogadores',
      label: (
        <>
          <UsersIcon className="size-4" /> Jogadores
          {online > 0 && <Badge variant="secondary">{online}</Badge>}
        </>
      ),
    },
    {
      id: 'combate',
      className: 'lg:hidden',
      label: (
        <>
          <SwordsIcon className="size-4" /> Combate
          {inCombat && <span className="size-2 rounded-full bg-emerald-500" aria-hidden />}
        </>
      ),
    },
    {
      id: 'rolagens',
      className: 'lg:hidden',
      label: (
        <>
          <DicesIcon className="size-4" /> Rolagens
        </>
      ),
    },
    {
      id: 'cutscene',
      label: (
        <>
          <ImageIcon className="size-4" /> Cutscene
        </>
      ),
    },
    {
      id: 'diario',
      label: (
        <>
          <BookOpenIcon className="size-4" /> Diário
        </>
      ),
    },
    {
      id: 'campanha',
      label: (
        <>
          <SettingsIcon className="size-4" /> Campanha
        </>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <GameMasterSessionBar campaign={campaign} />
      <TabBar label="Partes da campanha" tabs={tabs} active={tab} onChange={setTab} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div role="tabpanel" className={cn('min-w-0 space-y-4', side && 'max-lg:hidden')}>
          {main === 'jogadores' && (
            <>
              <InviteCard campaign={campaign} compact={online > 0} />
              <GameMasterPlayers campaign={campaign} />
            </>
          )}
          {main === 'cutscene' && <CutscenePanel campaignId={campaign.id} />}
          {main === 'diario' && <GameMasterJournal campaignId={campaign.id} />}
          {main === 'campanha' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2>Capa</h2>
                  </CardTitle>
                  <CardDescription>
                    Aparece no topo da campanha e na lista, e chega aos jogadores na sessão.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CampaignCoverEditor campaign={campaign} />
                </CardContent>
              </Card>
              <InviteCard campaign={campaign} compact={false} />
              <DangerZone
                campaign={campaign}
                title="Excluir campanha"
                description="A campanha será apagada deste dispositivo. As fichas não são apagadas."
                action="Excluir"
                icon={<Trash2Icon />}
              />
            </>
          )}
        </div>

        {/* Sempre à vista no computador, acompanhando a rolagem da página. */}
        <aside
          aria-label="Combate e rolagens"
          className={cn(
            'space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto',
            !side && 'max-lg:hidden',
          )}
        >
          <div className={cn(tab === 'rolagens' && 'max-lg:hidden')}>
            {active ? (
              <GameMasterInitiative campaignId={campaign.id} checkDice={checkDice} />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <SwordsIcon className="size-5" /> Combate
                  </CardTitle>
                  <CardDescription>Abra a sessão para conduzir o combate.</CardDescription>
                </CardHeader>
              </Card>
            )}
          </div>
          <div className={cn(tab === 'combate' && 'max-lg:hidden')}>
            <RollLog campaignId={campaign.id} isGameMaster />
          </div>
        </aside>
      </div>
    </div>
  );
}

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

/** Convite da campanha. `compact`: com jogadores na mesa, fica recolhido numa linha. */
function InviteCard({ campaign, compact }: { campaign: Campaign; compact: boolean }) {
  const { campaigns } = useServices();
  const [open, setOpen] = useState(false);
  const baseUrl = publicAppUrl();
  const code = encodeInvite(inviteFor(campaign));
  const link = baseUrl ? campaigns.inviteLink(campaign, baseUrl) : null;

  if (compact && !open) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Falta alguém?</span>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <UserPlusIcon /> Convidar jogadores
        </Button>
        {link && (
          <Button size="sm" variant="ghost" onClick={() => void copy(link, 'Link')}>
            <CopyIcon /> Copiar link
          </Button>
        )}
      </div>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Convidar jogadores</h2>
        </CardTitle>
        <CardDescription>
          Envie o convite pelo chat do grupo. Quem tiver o convite entra na mesa: compartilhe só com
          seus jogadores.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {link && (
          <div className="space-y-2">
            <Label htmlFor="convite-link">Link</Label>
            <div className="flex gap-2">
              <Input id="convite-link" readOnly value={link} onFocus={(e) => e.target.select()} />
              <Button type="button" onClick={() => void copy(link, 'Link')}>
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
              onClick={() => void copy(code, 'Código')}
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
  );
}
