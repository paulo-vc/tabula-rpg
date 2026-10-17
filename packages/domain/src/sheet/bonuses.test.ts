import { describe, expect, it } from 'vitest';
import { compiledMiniTemplate } from '../testing/fixtures';
import { bonusEffects, BonusSchema, type Bonus } from './bonuses';
import { computeDerived } from './compute';
import { CharacterSheetSchema } from './schema';

const bonus = (overrides: Partial<Bonus> = {}): Bonus => ({
  id: 'b1',
  name: 'Cinto de Força',
  kind: 'item',
  active: true,
  targets: [{ fieldId: 'f_for', value: 2 }],
  ...overrides,
});

const compiled = compiledMiniTemplate();
// Nível 5 (proficiência +3), Força 16 (mod +3), proficiente em Atletismo.
const values = { f_nivel: 5, f_for: 16, f_prof_atletismo: true };
const valueOf = (derived: ReturnType<typeof computeDerived>, id: string) => {
  const result = derived.computed[id];
  return result?.ok ? result.value : undefined;
};

describe('bônus no cálculo da ficha', () => {
  it('sem bônus, nada muda', () => {
    const derived = computeDerived(compiled, values, []);
    expect(valueOf(derived, 'f_for_mod')).toBe(3);
    expect(valueOf(derived, 'f_bonus_prof')).toBe(3);
    expect(valueOf(derived, 'f_atletismo')).toBe(6);
  });

  it('+2 de Força muda o modificador e a perícia que usa Força', () => {
    const derived = computeDerived(compiled, values, [bonus()]);
    expect(valueOf(derived, 'f_for_mod')).toBe(4); // Força 18
    expect(valueOf(derived, 'f_atletismo')).toBe(7);
  });

  it('+1 no bônus de proficiência (calculado) muda o resultado e quem depende dele', () => {
    const blessing = bonus({
      name: 'Bênção',
      kind: 'bencao',
      targets: [{ fieldId: 'f_bonus_prof', value: 1 }],
    });
    const derived = computeDerived(compiled, values, [blessing]);
    expect(valueOf(derived, 'f_bonus_prof')).toBe(4);
    expect(valueOf(derived, 'f_atletismo')).toBe(7);
  });

  it('+2 direto na perícia; bônus desativado não conta; vários somam', () => {
    const derived = computeDerived(compiled, values, [
      bonus({ id: 'a', targets: [{ fieldId: 'f_atletismo', value: 2 }] }),
      bonus({ id: 'b', targets: [{ fieldId: 'f_atletismo', value: 1 }] }),
      bonus({ id: 'c', active: false, targets: [{ fieldId: 'f_atletismo', value: 10 }] }),
      bonus({ id: 'd', kind: 'maldicao', targets: [{ fieldId: 'f_atletismo', value: -1 }] }),
    ]);
    expect(valueOf(derived, 'f_atletismo')).toBe(8);
  });

  it('bônus em campo que não existe é ignorado', () => {
    const derived = computeDerived(compiled, values, [
      bonus({ targets: [{ fieldId: 'f_fantasma', value: 5 }] }),
    ]);
    expect(valueOf(derived, 'f_atletismo')).toBe(6);
  });
});

describe('bonusEffects', () => {
  it('soma por campo, com as origens, e ignora os inativos e os zerados', () => {
    const effects = bonusEffects([
      bonus(),
      bonus({
        id: 'b2',
        name: 'Maldição',
        kind: 'maldicao',
        targets: [
          { fieldId: 'f_for', value: -1 },
          { fieldId: 'f_ca', value: 0 },
        ],
      }),
      bonus({ id: 'b3', active: false }),
    ]);
    expect(effects.get('f_for')).toEqual({
      total: 1,
      sources: [
        { name: 'Cinto de Força', kind: 'item', value: 2 },
        { name: 'Maldição', kind: 'maldicao', value: -1 },
      ],
    });
    expect(effects.has('f_ca')).toBe(false);
  });
});

describe('BonusSchema', () => {
  it('precisa de nome e de pelo menos um alvo, e o valor é inteiro e limitado', () => {
    expect(BonusSchema.safeParse(bonus()).success).toBe(true);
    expect(BonusSchema.safeParse(bonus({ name: ' ' })).success).toBe(false);
    expect(BonusSchema.safeParse(bonus({ targets: [] })).success).toBe(false);
    expect(
      BonusSchema.safeParse(bonus({ targets: [{ fieldId: 'f_for', value: 1.5 }] })).success,
    ).toBe(false);
    expect(
      BonusSchema.safeParse(bonus({ targets: [{ fieldId: 'f_for', value: 5000 }] })).success,
    ).toBe(false);
  });

  it('a ficha guarda os bônus (e continua válida sem eles)', () => {
    const sheet = {
      id: 's1',
      name: 'Lia',
      ownerId: 'u1',
      templateRef: { id: 'mini-5e', version: '1.0.0', source: 'local' as const },
      values: {},
      createdAt: 0,
      updatedAt: 0,
    };
    expect(CharacterSheetSchema.safeParse(sheet).success).toBe(true);
    expect(CharacterSheetSchema.safeParse({ ...sheet, bonuses: [bonus()] }).success).toBe(true);
  });
});
