import {
  createCampaign,
  err,
  inviteFor,
  joinCampaign,
  linkSheet,
  ok,
  type Campaign,
  type CampaignInvite,
  type CampaignRepository,
  type CharacterSheet,
  type DeviceRepository,
  type Issue,
  type Result,
  type SheetRepository,
} from '@tabula/domain';
import type { TemplateCatalog } from './catalog';
import { inviteUrl } from './invite-link';
import type { Clock, IdGenerator, SheetService } from './sheets';

const failure = (code: string, message: string): { ok: false; error: Issue } =>
  err({ code, path: [], message });

/** Casos de uso das campanhas (mesas), do lado do Mestre e do jogador. */
export class CampaignService {
  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly sheetRepository: SheetRepository,
    private readonly sheets: SheetService,
    private readonly catalog: TemplateCatalog,
    private readonly device: DeviceRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly newSecret: () => string,
  ) {}

  /** O Mestre cria a campanha e define o sistema oficial dela. */
  async create(input: { name: string; templateId: string; gmName: string }): Promise<Campaign> {
    const template = await this.catalog.get(input.templateId);
    if (!template) throw new Error(`Sistema não encontrado: ${input.templateId}`);
    await this.device.setDisplayName(input.gmName);
    const campaign = createCampaign({
      id: this.ids.newId(),
      name: input.name,
      template,
      gm: { userId: await this.device.getDeviceId(), displayName: input.gmName },
      secret: this.newSecret(),
      now: this.clock.now(),
    });
    await this.campaigns.save(campaign);
    return campaign;
  }

  inviteLink(campaign: Campaign, baseUrl: string): string {
    return inviteUrl(inviteFor(campaign), baseUrl);
  }

  /**
   * O jogador entra pelo convite. Entrar de novo na mesma campanha não duplica nada:
   * devolve a campanha que já está no dispositivo.
   */
  async join(invite: CampaignInvite, displayName: string): Promise<Result<Campaign, Issue>> {
    const existing = await this.campaigns.get(invite.campaignId);
    if (existing) return ok(existing);
    const userId = await this.device.getDeviceId();
    const joined = joinCampaign(invite, { userId, displayName }, this.clock.now());
    if (!joined.ok) return joined;
    await this.device.setDisplayName(displayName);
    await this.campaigns.save(joined.value);
    return joined;
  }

  /** Vincula uma ficha existente do jogador (do sistema da campanha). */
  async linkSheet(campaignId: string, sheetId: string): Promise<Result<Campaign, Issue>> {
    const campaign = await this.campaigns.get(campaignId);
    if (!campaign) return failure('campanha-ausente', 'Campanha não encontrada.');
    const sheet = await this.sheetRepository.get(sheetId);
    if (!sheet) return failure('ficha-ausente', 'Ficha não encontrada.');
    const linked = linkSheet(campaign, await this.me(campaign), sheet, this.clock.now());
    if (linked.ok) await this.campaigns.save(linked.value);
    return linked;
  }

  /** Cria uma ficha nova no sistema da campanha e já a vincula. */
  async createLinkedSheet(
    campaignId: string,
    name: string,
  ): Promise<Result<CharacterSheet, Issue>> {
    const campaign = await this.campaigns.get(campaignId);
    if (!campaign) return failure('campanha-ausente', 'Campanha não encontrada.');
    if (!(await this.catalog.get(campaign.templateRef.id))) {
      return failure(
        'sistema-ausente',
        `O sistema "${campaign.templateName}" não está instalado. Importe-o ou peça o arquivo ao Mestre.`,
      );
    }
    const sheet = await this.sheets.create({ name, templateId: campaign.templateRef.id });
    const linked = await this.linkSheet(campaignId, sheet.id);
    return linked.ok ? ok(sheet) : linked;
  }

  /** Fichas deste dispositivo que podem ser vinculadas (mesmo sistema da campanha). */
  async compatibleSheets(campaign: Campaign): Promise<CharacterSheet[]> {
    return this.sheetRepository.listByTemplate(campaign.templateRef.id);
  }

  /** Apaga a campanha deste dispositivo (o Mestre encerra; o jogador sai). Fichas ficam. */
  delete(campaignId: string): Promise<void> {
    return this.campaigns.delete(campaignId);
  }

  /** Este dispositivo como membro da campanha. */
  private async me(campaign: Campaign) {
    const userId = await this.device.getDeviceId();
    const member = campaign.members.find((m) => m.userId === userId);
    const displayName =
      member?.displayName ??
      (userId === campaign.gmId ? campaign.gmName : await this.device.getDisplayName()) ??
      'Jogador';
    return { userId, displayName };
  }
}
