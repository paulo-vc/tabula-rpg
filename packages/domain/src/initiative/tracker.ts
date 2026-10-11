import { z } from 'zod';
import { IdSchema, LabelSchema } from '../schema/primitives';

/** Participantes de um combate (jogadores + inimigos e aliados do Mestre). */
export const COMBATANT_LIMIT = 40;
export const INITIATIVE_RANGE = 999;

const InitiativeSchema = z.number().int().min(-INITIATIVE_RANGE).max(INITIATIVE_RANGE);

export const CombatantSchema = z.object({
  id: IdSchema,
  name: LabelSchema,
  initiative: InitiativeSchema,
  /** Jogador da mesa (com a ficha na sessão) ou criatura controlada pelo Mestre. */
  kind: z.enum(['jogador', 'npc']),
  /** Do jogador: assim ele reconhece a própria vez. */
  userId: IdSchema.optional(),
  /** Só o Mestre vê (ex.: o monstro que ainda não apareceu). */
  hidden: z.boolean(),
});
export type Combatant = z.infer<typeof CombatantSchema>;

const uniqueIds = (combatants: readonly { id: string }[]) =>
  new Set(combatants.map((c) => c.id)).size === combatants.length;

/**
 * Ordem de turno do combate, do lado do Mestre. `preparando`: as iniciativas estão sendo
 * definidas; `combate`: `activeId` age agora, na rodada `round`.
 */
export const TrackerSchema = z
  .object({
    phase: z.enum(['preparando', 'combate']),
    round: z.number().int().min(1).max(9999),
    activeId: IdSchema.nullable(),
    combatants: z.array(CombatantSchema).max(COMBATANT_LIMIT),
  })
  .refine((t) => uniqueIds(t.combatants), 'Participante repetido')
  .refine(
    (t) => t.activeId === null || t.combatants.some((c) => c.id === t.activeId),
    'Turno de quem não está no combate',
  );
export type Tracker = z.infer<typeof TrackerSchema>;

/**
 * O que os jogadores recebem: sem os ocultos. Na vez de um oculto, ninguém aparece como
 * ativo (`activeId` nulo), e o jogador vê "vez do Mestre".
 */
export const PublicTrackerSchema = z
  .object({
    phase: z.enum(['preparando', 'combate']),
    round: z.number().int().min(1).max(9999),
    activeId: IdSchema.nullable(),
    combatants: z.array(CombatantSchema.omit({ hidden: true })).max(COMBATANT_LIMIT),
  })
  .refine((t) => uniqueIds(t.combatants), 'Participante repetido')
  .refine(
    (t) => t.activeId === null || t.combatants.some((c) => c.id === t.activeId),
    'Turno de quem não está no combate',
  );
export type PublicTracker = z.infer<typeof PublicTrackerSchema>;

/** Novo combate com os jogadores presentes, todos com iniciativa 0 até o Mestre definir. */
export function startCombat(
  players: readonly { id: string; name: string; userId: string }[],
): Tracker {
  return {
    phase: 'preparando',
    round: 1,
    activeId: null,
    combatants: players.slice(0, COMBATANT_LIMIT).map((player) => ({
      id: player.id,
      name: player.name,
      initiative: 0,
      kind: 'jogador',
      userId: player.userId,
      hidden: false,
    })),
  };
}

/** Ordem de ação: maior iniciativa primeiro; empate mantém a ordem em que entraram. */
export function turnOrder<T extends { initiative: number }>(combatants: readonly T[]): T[] {
  return combatants
    .map((combatant, index) => ({ combatant, index }))
    .sort((a, b) => b.combatant.initiative - a.combatant.initiative || a.index - b.index)
    .map(({ combatant }) => combatant);
}

export function addCombatant(tracker: Tracker, combatant: Combatant): Tracker {
  if (tracker.combatants.length >= COMBATANT_LIMIT) return tracker;
  if (tracker.combatants.some((c) => c.id === combatant.id)) return tracker;
  return { ...tracker, combatants: [...tracker.combatants, combatant] };
}

export function updateCombatant(
  tracker: Tracker,
  id: string,
  changes: Partial<Pick<Combatant, 'name' | 'initiative' | 'hidden'>>,
): Tracker {
  return {
    ...tracker,
    combatants: tracker.combatants.map((c) => (c.id === id ? { ...c, ...changes } : c)),
  };
}

/** Remove um participante. Se era a vez dele, a vez passa ao seguinte. */
export function removeCombatant(tracker: Tracker, id: string): Tracker {
  if (!tracker.combatants.some((c) => c.id === id)) return tracker;
  const advanced = tracker.activeId === id ? nextTurn(tracker) : tracker;
  const combatants = advanced.combatants.filter((c) => c.id !== id);
  // Era o único: não sobra ninguém para agir.
  if (combatants.length === 0) {
    return { ...advanced, phase: 'preparando', round: 1, activeId: null, combatants };
  }
  return { ...advanced, combatants };
}

/** Passa a vez. Na preparação, começa o combate com o primeiro da ordem. */
export function nextTurn(tracker: Tracker): Tracker {
  const order = turnOrder(tracker.combatants);
  if (order.length === 0) return tracker;
  const index = order.findIndex((c) => c.id === tracker.activeId);
  if (tracker.phase === 'preparando' || index === -1) {
    return { ...tracker, phase: 'combate', activeId: order[0]?.id ?? null };
  }
  const wraps = index === order.length - 1;
  return {
    ...tracker,
    round: wraps ? Math.min(tracker.round + 1, 9999) : tracker.round,
    activeId: order[wraps ? 0 : index + 1]?.id ?? null,
  };
}

/** Volta a vez (corrigir um clique a mais). No primeiro turno do combate, não faz nada. */
export function previousTurn(tracker: Tracker): Tracker {
  const order = turnOrder(tracker.combatants);
  const index = order.findIndex((c) => c.id === tracker.activeId);
  if (tracker.phase !== 'combate' || index === -1) return tracker;
  if (index === 0) {
    if (tracker.round === 1) return tracker;
    return { ...tracker, round: tracker.round - 1, activeId: order.at(-1)?.id ?? null };
  }
  return { ...tracker, activeId: order[index - 1]?.id ?? null };
}

/** A ordem como os jogadores a veem (sem os ocultos). */
export function publicView(tracker: Tracker): PublicTracker {
  const visible = tracker.combatants.filter((c) => !c.hidden);
  const activeVisible = visible.some((c) => c.id === tracker.activeId);
  return {
    phase: tracker.phase,
    round: tracker.round,
    activeId: activeVisible ? tracker.activeId : null,
    combatants: visible.map(({ hidden: _hidden, ...rest }) => rest),
  };
}
