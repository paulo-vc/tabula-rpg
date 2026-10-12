import 'fake-indexeddb/auto';
import {
  addCombatant,
  inviteFor,
  nextTurn,
  startCombat,
  updateCombatant,
  type Campaign,
} from '@tabula/domain';
import { TabulaDatabase } from '@tabula/storage';
import { generateGmKeyPair, MemoryNetwork, SessionHost } from '@tabula/sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServices, type Services } from './services';

let network: MemoryNetwork;
let gmDb: TabulaDatabase;
let playerDb: TabulaDatabase;
let gm: Services;
let player: Services;

beforeEach(() => {
  network = new MemoryNetwork();
  gmDb = new TabulaDatabase(`sessao-mestre-${crypto.randomUUID()}`);
  playerDb = new TabulaDatabase(`sessao-jogador-${crypto.randomUUID()}`);
  // Cada sessão entra na mesma sala simulada.
  const createTransport = () => network.join();
  gm = createServices(gmDb, { createTransport });
  player = createServices(playerDb, { createTransport });
});

afterEach(async () => {
  await gm.session.stop();
  await player.session.stop();
  await network.settle();
  for (const db of [gmDb, playerDb]) {
    db.close();
    await db.delete();
  }
});

/** Espera a rede simulada e as consultas reativas do banco se acomodarem. */
async function eventually(assertion: () => void | Promise<void>) {
  await vi.waitFor(
    async () => {
      await network.settle();
      await assertion();
    },
    { timeout: 3000, interval: 20 },
  );
}

/** Mestre cria a campanha; jogadora entra e cria a ficha vinculada. */
async function setUpTable() {
  const campaign = await gm.campaigns.create({
    name: 'A Mina Perdida',
    templateId: 'dnd5e-srd',
    gmName: 'Paulo',
  });
  await player.campaigns.join(inviteFor(campaign), 'Ana');
  const created = await player.campaigns.createLinkedSheet(campaign.id, 'Lia');
  if (!created.ok) throw new Error(created.error.message);
  return { campaign, sheet: created.value };
}

const gmPlayers = () => {
  const snapshot = gm.session.getSnapshot();
  return snapshot.kind === 'mestre' ? snapshot.players : [];
};

describe('sessão ao vivo', () => {
  it('o Mestre vê a jogadora entrar com a ficha', async () => {
    const { campaign, sheet } = await setUpTable();
    expect(await gm.session.startAsGameMaster(campaign.id)).toEqual({ ok: true, value: undefined });
    expect(await player.session.joinAsPlayer(campaign.id)).toEqual({ ok: true, value: undefined });

    await eventually(() => {
      expect(player.session.getSnapshot()).toMatchObject({
        kind: 'jogador',
        status: { state: 'conectado' },
      });
      expect(gmPlayers()).toEqual([
        expect.objectContaining({
          sheetId: sheet.id,
          displayName: 'Ana',
          online: true,
          sheet: expect.objectContaining({ name: 'Lia', values: sheet.values }),
        }),
      ]);
    });
  });

  it('alterações feitas na ficha chegam ao Mestre', async () => {
    const { campaign, sheet } = await setUpTable();
    await gm.session.startAsGameMaster(campaign.id);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(() => expect(gmPlayers()[0]?.online).toBe(true));

    await player.sheets.setValue(sheet.id, 'hp', { current: 3, max: 10 });
    await player.sheets.setValue(sheet.id, 'condicoes', ['envenenado']);

    await eventually(() =>
      expect(gmPlayers()[0]?.sheet?.values).toMatchObject({
        hp: { current: 3, max: 10 },
        condicoes: ['envenenado'],
      }),
    );
  });

  it('ao encerrar, o estado é salvo e o Mestre reabre vendo a última ficha', async () => {
    const { campaign, sheet } = await setUpTable();
    await gm.session.startAsGameMaster(campaign.id);
    await player.session.joinAsPlayer(campaign.id);
    await player.sheets.setValue(sheet.id, 'for', 18);
    await eventually(() => expect(gmPlayers()[0]?.sheet?.values.for).toBe(18));

    await player.session.stop();
    await gm.session.stop();
    expect(gm.session.getSnapshot()).toEqual({ kind: 'nenhuma' });

    await gm.session.startAsGameMaster(campaign.id);
    await eventually(() =>
      expect(gmPlayers()[0]).toMatchObject({ online: false, sheet: { values: { for: 18 } } }),
    );
  });

  it('jogadora sem ficha vinculada não entra', async () => {
    const campaign = await gm.campaigns.create({
      name: 'Mesa',
      templateId: 'dnd5e-srd',
      gmName: 'Paulo',
    });
    await player.campaigns.join(inviteFor(campaign), 'Ana');
    expect(await player.session.joinAsPlayer(campaign.id)).toMatchObject({
      ok: false,
      error: { code: 'sem-ficha' },
    });
  });

  it('só o Mestre inicia a sessão', async () => {
    const { campaign } = await setUpTable();
    expect(await player.session.startAsGameMaster(campaign.id)).toMatchObject({
      ok: false,
      error: { code: 'nao-e-mestre' },
    });
  });

  it('avisa quem acompanha a sessão a cada mudança', async () => {
    const { campaign } = await setUpTable();
    const listener = vi.fn();
    const unsubscribe = gm.session.subscribe(listener);
    await gm.session.startAsGameMaster(campaign.id);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(() => expect(gmPlayers()[0]?.online).toBe(true));
    unsubscribe();
    expect(listener.mock.calls.length).toBeGreaterThan(1);
  });

  it('excluir a campanha apaga o estado salvo da sessão', async () => {
    const { campaign } = await setUpTable();
    await gm.session.startAsGameMaster(campaign.id);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(() => expect(gmPlayers()[0]?.online).toBe(true));
    await gm.session.stop();
    expect(
      await gmDb.sessionStates.where('campaignId').equals(campaign.id).count(),
    ).toBeGreaterThan(0);

    await gm.campaigns.delete(campaign.id);
    expect(await gmDb.sessionStates.where('campaignId').equals(campaign.id).count()).toBe(0);
  });
});

describe('envio do sistema pelo Mestre', () => {
  const homebrew = {
    id: 'caixa-preta',
    version: '1.0.0',
    name: 'Caixa Preta',
    source: 'local' as const,
    fields: [
      { id: 'vigor', key: 'vigor', label: 'Vigor', type: 'number' as const, default: 2 },
      { id: 'pv', key: 'pv', label: 'PV', type: 'resource' as const, default: 6 },
    ],
    layouts: { full: [], gmSummary: ['pv'] },
  };

  async function homebrewTable() {
    expect(await gm.files.installTemplate(homebrew)).toMatchObject({ ok: true });
    const campaign = await gm.campaigns.create({
      name: 'Mesa caseira',
      templateId: 'caixa-preta',
      gmName: 'Paulo',
    });
    await player.campaigns.join(inviteFor(campaign), 'Ana');
    return campaign;
  }

  /** Resolve a promessa processando a rede simulada enquanto isso. */
  async function whileNetworking<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    void promise.then(() => (done = true));
    for (let i = 0; i < 200 && !done; i++) {
      await network.settle();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return promise;
  }

  it('a jogadora recebe o sistema, cria a ficha e entra na sessão', async () => {
    const campaign = await homebrewTable();
    expect(await player.campaigns.createLinkedSheet(campaign.id, 'Lia')).toMatchObject({
      ok: false,
      error: { code: 'sistema-ausente' },
    });

    await gm.session.startAsGameMaster(campaign.id);
    const receipt = await whileNetworking(player.session.receiveTemplate(campaign.id));
    expect(receipt).toMatchObject({ ok: true, kind: 'template', template: { id: 'caixa-preta' } });
    expect(await player.catalog.get('caixa-preta')).toMatchObject({
      name: 'Caixa Preta',
      source: 'local',
    });

    const created = await player.campaigns.createLinkedSheet(campaign.id, 'Lia');
    expect(created.ok).toBe(true);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(() =>
      expect(gmPlayers()[0]).toMatchObject({
        online: true,
        sheet: { values: { pv: { current: 6, max: 6 } } },
      }),
    );
  });

  it('o pedido pode ser cancelado enquanto espera o Mestre', async () => {
    const campaign = await homebrewTable();
    const controller = new AbortController();
    const pending = player.session.receiveTemplate(campaign.id, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: 'cancelado' });
    expect(await player.catalog.get('caixa-preta')).toBeUndefined();
  });

  it('sistemas nativos não são enviados (todos já têm)', async () => {
    const { campaign } = await setUpTable(); // D&D, nativo
    await gm.session.startAsGameMaster(campaign.id);
    const controller = new AbortController();
    const pending = whileNetworking(player.session.receiveTemplate(campaign.id, controller.signal));
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toEqual({ ok: false, reason: 'cancelado' });
  });
});

describe('o Mestre altera fichas (Fase 7)', () => {
  /** Sistema com um campo secreto, instalado nos dois aparelhos. */
  const SECRET_TEMPLATE = {
    id: 'mesa-secreta',
    version: '1.0.0',
    name: 'Mesa Secreta',
    source: 'local' as const,
    fields: [
      { id: 'vigor', key: 'vigor', label: 'Vigor', type: 'number' as const, default: 2 },
      { id: 'pv', key: 'pv', label: 'PV', type: 'resource' as const, default: 10 },
      {
        id: 'maldicao',
        key: 'maldicao',
        label: 'Maldição',
        type: 'text' as const,
        visibility: 'gm' as const,
      },
    ],
    layouts: { full: [] },
  };

  async function setUpSecretTable() {
    for (const services of [gm, player]) await services.files.installTemplate(SECRET_TEMPLATE);
    const campaign = await gm.campaigns.create({
      name: 'Segredos',
      templateId: 'mesa-secreta',
      gmName: 'Paulo',
    });
    await player.campaigns.join(inviteFor(campaign), 'Ana');
    const created = await player.campaigns.createLinkedSheet(campaign.id, 'Lia');
    if (!created.ok) throw new Error(created.error.message);
    await gm.session.startAsGameMaster(campaign.id);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(() => expect(gmPlayers()[0]?.online).toBe(true));
    return { campaign, sheet: created.value };
  }

  it('a alteração do Mestre chega à ficha da jogadora e ela é avisada', async () => {
    const { campaign, sheet } = await setUpSecretTable();
    const result = await gm.session.setPlayerValue(campaign.id, sheet.id, 'pv', {
      current: 4,
      max: 10,
    });
    expect(result).toEqual({ ok: true, value: undefined });

    await eventually(async () => {
      expect((await player.sheets.open(sheet.id)).status).toBe('pronta');
      expect((await playerDb.sheets.get(sheet.id))?.values.pv).toEqual({ current: 4, max: 10 });
      expect(player.session.getSnapshot()).toMatchObject({
        gmChange: { fieldIds: ['pv'], count: 1 },
      });
    });
  });

  it('campo secreto fica só no aparelho do Mestre', async () => {
    const { campaign, sheet } = await setUpSecretTable();
    await player.sheets.setValue(sheet.id, 'maldicao', 'tentativa da jogadora');
    await gm.session.setPlayerValue(campaign.id, sheet.id, 'maldicao', 'Licantropia');
    await gm.session.setPlayerValue(campaign.id, sheet.id, 'vigor', 5);

    await eventually(async () =>
      expect((await playerDb.sheets.get(sheet.id))?.values.vigor).toBe(5),
    );
    expect(await gm.session.secretValues(campaign.id, sheet.id)).toEqual({
      maldicao: 'Licantropia',
    });
    // Nada secreto trafegou: nem o valor do Mestre chegou à jogadora, nem o dela ao Mestre.
    expect((await playerDb.sheets.get(sheet.id))?.values.maldicao).toBe('tentativa da jogadora');
    expect(gmPlayers()[0]?.sheet?.values).not.toHaveProperty('maldicao');
  });

  it('recusa valor inválido, campo inexistente e edição sem sessão aberta', async () => {
    const { campaign, sheet } = await setUpSecretTable();
    expect(await gm.session.setPlayerValue(campaign.id, sheet.id, 'vigor', 'muito')).toMatchObject({
      ok: false,
      error: { code: 'valor-invalido' },
    });
    expect(await gm.session.setPlayerValue(campaign.id, sheet.id, 'nada', 1)).toMatchObject({
      ok: false,
      error: { code: 'campo-ausente' },
    });
    await gm.session.stop();
    expect(await gm.session.setPlayerValue(campaign.id, sheet.id, 'vigor', 3)).toMatchObject({
      ok: false,
      error: { code: 'sem-sessao' },
    });
    // Campos secretos não dependem da sessão: ficam no aparelho do Mestre.
    expect(await gm.session.setPlayerValue(campaign.id, sheet.id, 'maldicao', 'x')).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('a jogadora offline recebe a alteração ao voltar', async () => {
    const { campaign, sheet } = await setUpSecretTable();
    await player.session.stop();
    await eventually(() => expect(gmPlayers()[0]?.online).toBe(false));

    await gm.session.setPlayerValue(campaign.id, sheet.id, 'vigor', 9);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(async () =>
      expect((await playerDb.sheets.get(sheet.id))?.values.vigor).toBe(9),
    );
  });
});

describe('rolagens (Fase 7b)', () => {
  async function liveTable() {
    const table = await setUpTable();
    await gm.session.startAsGameMaster(table.campaign.id);
    await player.session.joinAsPlayer(table.campaign.id);
    await eventually(() => expect(gmPlayers()[0]?.online).toBe(true));
    await eventually(() =>
      expect(player.session.getSnapshot()).toMatchObject({ status: { state: 'conectado' } }),
    );
    return table;
  }

  it('a rolagem da jogadora entra no registro dos dois e avisa o Mestre', async () => {
    const { campaign } = await liveTable();
    const seen: string[] = [];
    gm.session.onRoll((entry) => seen.push(entry.label));

    const result = await player.session.roll({ label: 'Atletismo', expression: '1d20+5' });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({ authorName: 'Ana', secret: false });
    expect(result.value.result.total).toBeGreaterThanOrEqual(6);
    expect(result.value.result.total).toBeLessThanOrEqual(25);

    await eventually(async () => {
      expect((await gm.session.rolls(campaign.id)).map((r) => r.id)).toEqual([result.value.id]);
      expect(seen).toEqual(['Atletismo']);
    });
    expect(await player.session.rolls(campaign.id)).toHaveLength(1);
  });

  it('rolagem secreta do Mestre fica só com ele; a pública chega à jogadora', async () => {
    const { campaign } = await liveTable();
    await gm.session.roll({ label: 'Emboscada', expression: '1d20', secret: true });
    const open = await gm.session.roll({ label: 'Iniciativa do dragão', expression: '1d20+2' });
    if (!open.ok) throw new Error('falhou');

    await eventually(async () =>
      expect((await player.session.rolls(campaign.id)).map((r) => r.label)).toEqual([
        'Iniciativa do dragão',
      ]),
    );
    expect((await gm.session.rolls(campaign.id)).map((r) => r.label)).toEqual([
      'Emboscada',
      'Iniciativa do dragão',
    ]);
  });

  it('a jogadora não consegue rolar em segredo', async () => {
    await liveTable();
    const result = await player.session.roll({ label: 'x', expression: '1d6', secret: true });
    expect(result).toMatchObject({ ok: true, value: { secret: false } });
  });

  it('quem volta à sessão recebe as rolagens que perdeu', async () => {
    const { campaign } = await liveTable();
    await player.session.stop();
    await gm.session.roll({ label: 'Enquanto ela estava fora', expression: '2d6' });

    await player.session.joinAsPlayer(campaign.id);
    await eventually(async () =>
      expect((await player.session.rolls(campaign.id)).map((r) => r.label)).toContain(
        'Enquanto ela estava fora',
      ),
    );
  });

  it('fora de uma sessão só mostra o resultado; expressão inválida é recusada', async () => {
    const { campaign } = await setUpTable();
    expect(await player.session.roll({ label: 'Solo', expression: '3d6' })).toMatchObject({
      ok: true,
    });
    expect(await player.session.rolls(campaign.id)).toEqual([]);
    expect(await player.session.roll({ label: 'x', expression: '1d20*2' })).toMatchObject({
      ok: false,
      error: { code: 'expressao-invalida' },
    });
  });

  it('o registro sai junto com a campanha', async () => {
    const { campaign } = await liveTable();
    await gm.session.roll({ label: 'x', expression: '1d4' });
    await gm.session.stop();
    await gm.campaigns.delete(campaign.id);
    expect(await gm.session.rolls(campaign.id)).toEqual([]);
  });
});

describe('identidade do Mestre', () => {
  const playerSnapshot = () => {
    const snapshot = player.session.getSnapshot();
    if (snapshot.kind !== 'jogador') throw new Error('o jogador não está em sessão');
    return snapshot;
  };

  it('a campanha nova tem chave, e a privada fica só no aparelho do Mestre', async () => {
    const { campaign } = await setUpTable();
    expect(campaign.gmKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await gmDb.gmKeys.get(campaign.id)).toBeDefined();
    expect(await playerDb.gmKeys.count()).toBe(0);
    expect(JSON.stringify(inviteFor(campaign))).not.toContain(
      (await gmDb.gmKeys.get(campaign.id))?.secretKey,
    );
    expect((await player.campaignRepository.get(campaign.id))?.gmKey).toBe(campaign.gmKey);
  });

  it('o jogador reconhece o Mestre pela prova da chave', async () => {
    const { campaign } = await setUpTable();
    await gm.session.startAsGameMaster(campaign.id);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(() =>
      expect(playerSnapshot()).toMatchObject({
        status: { state: 'conectado' },
        gmIdentity: 'verificada',
        impersonations: 0,
      }),
    );
  });

  it('quem tem o convite, mas não a chave, não se passa pelo Mestre', async () => {
    const { campaign } = await setUpTable();
    await player.session.joinAsPlayer(campaign.id);
    // O impostor sabe sala, ID do Mestre e segredo, e assina com uma chave que inventou.
    const impostor = new SessionHost(
      network.join(),
      {
        id: campaign.id,
        gmId: campaign.gmId,
        gmName: campaign.gmName,
        templateId: campaign.templateRef.id,
        identity: generateGmKeyPair(),
      },
      new Map(),
    );
    impostor.start();

    await eventually(() =>
      expect(playerSnapshot()).toMatchObject({
        status: { state: 'procurando-mestre' },
        gmIdentity: null,
        impersonations: expect.any(Number),
      }),
    );
    expect(playerSnapshot().impersonations).toBeGreaterThan(0);

    // O Mestre verdadeiro chega depois e a sessão acontece normalmente.
    await gm.session.startAsGameMaster(campaign.id);
    await eventually(() =>
      expect(playerSnapshot()).toMatchObject({
        status: { state: 'conectado' },
        gmIdentity: 'verificada',
      }),
    );
    await impostor.stop();
  });

  it('campanha da v0.1 ganha chave na primeira sessão e o jogador a fixa', async () => {
    const { campaign } = await setUpTable();
    // Reproduz uma campanha criada antes da assinatura: nenhum dos dois lados tem chave.
    const withoutKey = ({ gmKey: _removed, ...rest }: Campaign): Campaign => rest;
    await gmDb.campaigns.put(withoutKey(campaign));
    const playerCopy = await player.campaignRepository.get(campaign.id);
    if (!playerCopy) throw new Error('o jogador não tem a campanha');
    await playerDb.campaigns.put(withoutKey(playerCopy));
    await gmDb.gmKeys.clear();

    await gm.session.startAsGameMaster(campaign.id);
    const upgraded = await gm.campaignRepository.get(campaign.id);
    expect(upgraded?.gmKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await gmDb.gmKeys.get(campaign.id))?.secretKey).toBeDefined();

    await player.session.joinAsPlayer(campaign.id);
    await eventually(async () => {
      expect(playerSnapshot()).toMatchObject({
        status: { state: 'conectado' },
        gmIdentity: 'verificada',
      });
      expect((await player.campaignRepository.get(campaign.id))?.gmKey).toBe(upgraded?.gmKey);
    });
  });

  it('sem a chave privada, o Mestre não inicia a sessão (e a campanha não muda)', async () => {
    const { campaign } = await setUpTable();
    await gmDb.gmKeys.clear();

    const result = await gm.session.startAsGameMaster(campaign.id);
    expect(result).toMatchObject({ ok: false, error: { code: 'chave-do-mestre-ausente' } });
    expect(gm.session.getSnapshot()).toEqual({ kind: 'nenhuma' });
    expect((await gm.campaignRepository.get(campaign.id))?.gmKey).toBe(campaign.gmKey);
  });

  it('apagar a campanha apaga a chave privada', async () => {
    const { campaign } = await setUpTable();
    await gm.campaigns.delete(campaign.id);
    expect(await gmDb.gmKeys.get(campaign.id)).toBeUndefined();
  });
});

describe('ordem de turno', () => {
  const gmInitiative = () => {
    const snapshot = gm.session.getSnapshot();
    return snapshot.kind === 'mestre' ? snapshot.initiative : undefined;
  };
  const playerInitiative = () => {
    const snapshot = player.session.getSnapshot();
    return snapshot.kind === 'jogador' ? snapshot.initiative : undefined;
  };

  /** Mestre e jogadora em sessão; combate com a Lia (14) e um goblin oculto (18). */
  async function combat() {
    const { campaign, sheet } = await setUpTable();
    await gm.session.startAsGameMaster(campaign.id);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(() => expect(gmPlayers()[0]?.online).toBe(true));
    const ok = gm.session.updateInitiative(campaign.id, () =>
      addCombatant(
        updateCombatant(
          startCombat(
            gmPlayers().map((p) => ({
              id: p.sheetId,
              name: p.sheet?.name ?? p.displayName,
              userId: p.userId,
            })),
          ),
          sheet.id,
          { initiative: 14 },
        ),
        { id: 'goblin', name: 'Goblin', initiative: 18, kind: 'npc', hidden: true },
      ),
    );
    expect(ok).toEqual({ ok: true, value: undefined });
    return { campaign, sheet };
  }

  it('a jogadora vê a ordem sem o oculto; na vez dele, "vez do Mestre"', async () => {
    const { campaign, sheet } = await combat();
    gm.session.updateInitiative(campaign.id, (t) => t && nextTurn(t)); // vez do goblin
    expect(gmInitiative()).toMatchObject({ phase: 'combate', activeId: 'goblin' });
    await eventually(() =>
      expect(playerInitiative()).toEqual({
        phase: 'combate',
        round: 1,
        activeId: null,
        combatants: [
          {
            id: sheet.id,
            name: 'Lia',
            initiative: 14,
            kind: 'jogador',
            userId: expect.any(String),
          },
        ],
      }),
    );

    gm.session.updateInitiative(campaign.id, (t) => t && nextTurn(t)); // vez da Lia
    await eventually(() => expect(playerInitiative()?.activeId).toBe(sheet.id));
    const snapshot = player.session.getSnapshot();
    expect(snapshot.kind === 'jogador' && snapshot.userId).toBe(
      playerInitiative()?.combatants[0]?.userId,
    );
  });

  it('encerrar o combate limpa a ordem dos dois lados', async () => {
    const { campaign } = await combat();
    await eventually(() => expect(playerInitiative()).not.toBeNull());
    gm.session.updateInitiative(campaign.id, () => null);
    expect(gmInitiative()).toBeNull();
    await eventually(() => expect(playerInitiative()).toBeNull());
  });

  it('a ordem sobrevive ao Mestre encerrar e reabrir a sessão', async () => {
    const { campaign } = await combat();
    gm.session.updateInitiative(campaign.id, (t) => t && nextTurn(t));
    await gm.session.stop();
    await gm.session.startAsGameMaster(campaign.id);
    expect(gmInitiative()).toMatchObject({ phase: 'combate', activeId: 'goblin' });
    expect(gmInitiative()?.combatants).toHaveLength(2);
  });

  it('a iniciativa rolada pela jogadora entra na ordem do Mestre; outras rolagens, não', async () => {
    const { sheet } = await combat();
    await eventually(() => expect(playerInitiative()).not.toBeNull());

    const common = await player.session.roll({ label: 'Atletismo', expression: '1d1+5' });
    expect(common.ok).toBe(true);
    const rolled = await player.session.roll({
      label: 'Iniciativa',
      expression: '1d1+16',
      purpose: 'iniciativa',
    });
    expect(rolled).toMatchObject({ ok: true, value: { purpose: 'iniciativa' } });

    await eventually(() => {
      expect(gmInitiative()?.combatants.find((c) => c.id === sheet.id)?.initiative).toBe(17);
      expect(playerInitiative()?.combatants.find((c) => c.id === sheet.id)?.initiative).toBe(17);
    });
    // O inimigo do Mestre não muda.
    expect(gmInitiative()?.combatants.find((c) => c.id === 'goblin')?.initiative).toBe(18);
  });

  it('só o Mestre com a sessão aberta conduz o combate; ordem inválida é recusada', async () => {
    const { campaign } = await combat();
    expect(player.session.updateInitiative(campaign.id, () => null)).toMatchObject({
      ok: false,
      error: { code: 'sem-sessao' },
    });
    const invalid = gm.session.updateInitiative(
      campaign.id,
      (t) => t && { ...t, activeId: 'fantasma' },
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: 'ordem-invalida' } });
    expect(gmInitiative()?.activeId).toBeNull();
  });
});

describe('reentrada e tempo de conexão', () => {
  const playerSnapshot = () => {
    const snapshot = player.session.getSnapshot();
    if (snapshot.kind !== 'jogador') throw new Error('o jogador não está em sessão');
    return snapshot;
  };

  it('sair e entrar de novo: o Mestre vê offline e depois online; o tempo é medido', async () => {
    const { campaign } = await setUpTable();
    await gm.session.startAsGameMaster(campaign.id);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(() => expect(playerSnapshot().status).toEqual({ state: 'conectado' }));
    expect(playerSnapshot()).toMatchObject({ searchingSince: null });
    expect(playerSnapshot().connectedInMs).toBeGreaterThanOrEqual(0);

    await player.session.stop();
    await eventually(() => expect(gmPlayers()[0]?.online).toBe(false));

    await player.session.joinAsPlayer(campaign.id);
    await eventually(() => {
      expect(playerSnapshot().status).toEqual({ state: 'conectado' });
      expect(gmPlayers()[0]?.online).toBe(true);
    });
  });

  it('o Mestre encerra: a jogadora volta a procurar, com o tempo correndo', async () => {
    const { campaign } = await setUpTable();
    await gm.session.startAsGameMaster(campaign.id);
    await player.session.joinAsPlayer(campaign.id);
    await eventually(() => expect(playerSnapshot().status).toEqual({ state: 'conectado' }));

    await gm.session.stop();
    await eventually(() => {
      expect(playerSnapshot().status).toEqual({ state: 'procurando-mestre' });
      expect(playerSnapshot().searchingSince).not.toBeNull();
    });

    await gm.session.startAsGameMaster(campaign.id);
    await eventually(() => expect(playerSnapshot().status).toEqual({ state: 'conectado' }));
  });
});
