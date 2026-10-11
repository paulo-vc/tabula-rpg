import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addCombatant,
  nextTurn,
  previousTurn,
  publicView,
  PublicTrackerSchema,
  removeCombatant,
  startCombat,
  TrackerSchema,
  turnOrder,
  updateCombatant,
  type Combatant,
  type Tracker,
} from './tracker';

const npc = (id: string, initiative: number, hidden = false): Combatant => ({
  id,
  name: id,
  initiative,
  kind: 'npc',
  hidden,
});

/** Ana (15), Bia (10) e um goblin (12): ordem Ana, goblin, Bia. */
function table(): Tracker {
  let tracker = startCombat([
    { id: 'ana', name: 'Ana', userId: 'u-ana' },
    { id: 'bia', name: 'Bia', userId: 'u-bia' },
  ]);
  tracker = updateCombatant(tracker, 'ana', { initiative: 15 });
  tracker = updateCombatant(tracker, 'bia', { initiative: 10 });
  return addCombatant(tracker, npc('goblin', 12));
}

const ids = (tracker: Tracker) => turnOrder(tracker.combatants).map((c) => c.id);

describe('ordem de turno', () => {
  it('começa preparando, com os jogadores e iniciativa zero', () => {
    const tracker = startCombat([{ id: 'ana', name: 'Ana', userId: 'u-ana' }]);
    expect(tracker).toMatchObject({ phase: 'preparando', round: 1, activeId: null });
    expect(tracker.combatants[0]).toMatchObject({ kind: 'jogador', initiative: 0, hidden: false });
  });

  it('ordena pela iniciativa; empate fica na ordem de entrada', () => {
    expect(ids(table())).toEqual(['ana', 'goblin', 'bia']);
    const tie = addCombatant(table(), npc('orc', 12));
    expect(ids(tie)).toEqual(['ana', 'goblin', 'orc', 'bia']);
  });

  it('passa a vez e conta as rodadas', () => {
    let tracker = nextTurn(table());
    expect(tracker).toMatchObject({ phase: 'combate', round: 1, activeId: 'ana' });
    tracker = nextTurn(nextTurn(tracker));
    expect(tracker.activeId).toBe('bia');
    tracker = nextTurn(tracker);
    expect(tracker).toMatchObject({ round: 2, activeId: 'ana' });
  });

  it('volta a vez, inclusive para a rodada anterior, mas não antes do início', () => {
    const start = nextTurn(table());
    expect(previousTurn(start)).toEqual(start);
    const round2 = nextTurn(nextTurn(nextTurn(start)));
    expect(previousTurn(round2)).toMatchObject({ round: 1, activeId: 'bia' });
  });

  it('remover quem está agindo passa a vez ao seguinte', () => {
    const tracker = nextTurn(table()); // vez da Ana
    expect(removeCombatant(tracker, 'ana')).toMatchObject({ activeId: 'goblin', round: 1 });
    // O último da rodada sai: a rodada seguinte começa.
    const last = nextTurn(nextTurn(tracker)); // vez da Bia
    expect(removeCombatant(last, 'bia')).toMatchObject({ activeId: 'ana', round: 2 });
  });

  it('sem ninguém, volta à preparação', () => {
    let tracker = nextTurn(addCombatant(startCombat([]), npc('goblin', 5)));
    tracker = removeCombatant(tracker, 'goblin');
    expect(tracker).toMatchObject({ phase: 'preparando', round: 1, activeId: null });
    expect(nextTurn(tracker)).toEqual(tracker);
  });

  it('não aceita participante repetido nem passa do limite', () => {
    const tracker = table();
    expect(addCombatant(tracker, npc('ana', 1))).toBe(tracker);
    let full = startCombat([]);
    for (let i = 0; i < 50; i++) full = addCombatant(full, npc(`n${i}`, i));
    expect(full.combatants).toHaveLength(40);
  });
});

describe('o que os jogadores veem', () => {
  it('ocultos não aparecem; na vez de um oculto, ninguém está ativo', () => {
    let tracker = addCombatant(table(), npc('emboscada', 20, true));
    expect(publicView(tracker).combatants.map((c) => c.id)).toEqual(['ana', 'bia', 'goblin']);
    tracker = nextTurn(tracker); // a emboscada (20) age primeiro
    expect(tracker.activeId).toBe('emboscada');
    expect(publicView(tracker)).toMatchObject({ phase: 'combate', activeId: null });
    expect(JSON.stringify(publicView(tracker))).not.toContain('emboscada');
    expect(publicView(nextTurn(tracker)).activeId).toBe('ana');
  });

  it('o formato público não tem o campo `hidden` e passa no schema', () => {
    const view = publicView(nextTurn(table()));
    expect(view.combatants.every((c) => !('hidden' in c))).toBe(true);
    expect(PublicTrackerSchema.safeParse(view).success).toBe(true);
  });

  it('o schema recusa vez de quem não está no combate e IDs repetidos', () => {
    const view = publicView(table());
    expect(PublicTrackerSchema.safeParse({ ...view, activeId: 'fantasma' }).success).toBe(false);
    const dup = { ...view, combatants: [...view.combatants, view.combatants[0]] };
    expect(PublicTrackerSchema.safeParse(dup).success).toBe(false);
  });
});

describe('propriedade: qualquer sequência de operações mantém a ordem válida', () => {
  const operation = fc.oneof(
    fc.record({
      op: fc.constant('add' as const),
      id: fc.constantFrom('a', 'b', 'c', 'd', 'e'),
      ini: fc.integer({ min: -5, max: 25 }),
      hidden: fc.boolean(),
    }),
    fc.record({
      op: fc.constant('remove' as const),
      id: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'ana'),
    }),
    fc.record({
      op: fc.constant('set' as const),
      id: fc.constantFrom('a', 'b', 'ana'),
      ini: fc.integer({ min: -5, max: 25 }),
    }),
    fc.record({ op: fc.constantFrom('next' as const, 'previous' as const) }),
  );

  it('schemas válidos, rodada nunca diminui abaixo de 1, ativo sempre presente', () => {
    fc.assert(
      fc.property(fc.array(operation, { maxLength: 60 }), (operations) => {
        let tracker = startCombat([{ id: 'ana', name: 'Ana', userId: 'u-ana' }]);
        for (const step of operations) {
          if (step.op === 'add')
            tracker = addCombatant(tracker, npc(step.id, step.ini, step.hidden));
          else if (step.op === 'remove') tracker = removeCombatant(tracker, step.id);
          else if (step.op === 'set')
            tracker = updateCombatant(tracker, step.id, { initiative: step.ini });
          else if (step.op === 'next') tracker = nextTurn(tracker);
          else tracker = previousTurn(tracker);

          expect(TrackerSchema.safeParse(tracker).success).toBe(true);
          expect(PublicTrackerSchema.safeParse(publicView(tracker)).success).toBe(true);
          if (tracker.phase === 'combate') expect(tracker.activeId).not.toBeNull();
        }
      }),
    );
  });
});
