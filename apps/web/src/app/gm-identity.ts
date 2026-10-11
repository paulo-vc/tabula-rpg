import {
  err,
  ok,
  withGmKey,
  type Campaign,
  type CampaignRepository,
  type GmKeyRepository,
  type Issue,
  type Result,
} from '@tabula/domain';
import type { GmKeyPair } from '@tabula/sync';

/**
 * Garante que o Mestre tenha identidade verificável na campanha. Campanhas criadas na v0.1
 * não têm chave: ela é gerada na primeira sessão e passa a ir nos convites novos. Se a
 * campanha tem chave pública mas a privada se perdeu, não há como provar quem é o Mestre
 * (gerar outra faria todo jogador que já fixou a chave recusá-lo), então falha com clareza.
 */
export async function ensureGmIdentity(
  campaigns: CampaignRepository,
  gmKeys: GmKeyRepository,
  newKeyPair: () => GmKeyPair,
  campaign: Campaign,
  now: number,
): Promise<Result<{ campaign: Campaign; identity: GmKeyPair }, Issue>> {
  const stored = await gmKeys.get(campaign.id);
  if (stored && campaign.gmKey !== undefined) {
    return ok({ campaign, identity: { publicKey: campaign.gmKey, secretKey: stored.secretKey } });
  }
  if (campaign.gmKey !== undefined) {
    return err({
      code: 'chave-do-mestre-ausente',
      path: [],
      message:
        'A chave do Mestre desta campanha não está neste aparelho (os dados locais foram apagados ou a campanha veio de outro aparelho). Crie uma nova campanha e convide os jogadores de novo.',
    });
  }
  const identity = newKeyPair();
  await gmKeys.save({ campaignId: campaign.id, secretKey: identity.secretKey });
  const updated = withGmKey(campaign, identity.publicKey, now);
  await campaigns.save(updated);
  return ok({ campaign: updated, identity });
}
