import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useServices } from '@/app/services-context';
import { useLiveSession } from './use-live-session';

/** Avisa o jogador quando o Mestre altera a ficha dele (em qualquer tela do app). */
export function GmChangeNotice() {
  const { campaignRepository, catalog } = useServices();
  const live = useLiveSession();
  const change = live.kind === 'jogador' ? live.gmChange : undefined;
  const campaignId = live.kind === 'jogador' ? live.campaignId : undefined;
  const seen = useRef(0);

  useEffect(() => {
    if (!change || !campaignId || change.count === seen.current) return;
    seen.current = change.count;
    void (async () => {
      const campaign = await campaignRepository.get(campaignId);
      const template = campaign ? await catalog.get(campaign.templateRef.id) : undefined;
      const labels = change.fieldIds.map(
        (id) => template?.fields.find((field) => field.id === id)?.label ?? id,
      );
      toast.info('O Mestre alterou sua ficha', { description: labels.join(', ') });
    })();
  }, [change, campaignId, campaignRepository, catalog]);

  return null;
}
