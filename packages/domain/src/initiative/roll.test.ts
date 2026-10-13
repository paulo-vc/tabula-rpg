import { describe, expect, it } from 'vitest';
import { computeDerived } from '../sheet/compute';
import { createSheet } from '../sheet/operations';
import { compileTemplate } from '../template/compile';
import type { SystemTemplate } from '../template/schema';
import { clone, miniTemplate } from '../testing/fixtures';
import { initiativeExpression, parseInitiativeInput } from './roll';

function compiled(change: (t: SystemTemplate) => void) {
  const template = clone(miniTemplate());
  change(template);
  const result = compileTemplate(template);
  if (!result.ok) throw new Error(result.error.map((i) => i.message).join('\n'));
  return result.value;
}

const expressionFor = (
  change: (t: SystemTemplate) => void,
  values: Record<string, unknown> = {},
) => {
  const c = compiled(change);
  const sheet = createSheet(c, { id: 's', name: 'Teste', ownerId: 'u', now: 0 });
  const all = { ...sheet.values, ...values } as never;
  return initiativeExpression(c, all, computeDerived(c, all));
};

describe('rolagem de iniciativa', () => {
  it('dado dos testes + modificador calculado', () => {
    // f_for_mod = floor((@for - 10) / 2)
    expect(expressionFor((t) => (t.initiative = 'f_for_mod'), { f_for: 15 })).toBe('1d20+2');
    expect(expressionFor((t) => (t.initiative = 'f_for_mod'), { f_for: 8 })).toBe('1d20-1');
    expect(expressionFor((t) => (t.initiative = 'f_for_mod'), { f_for: 10 })).toBe('1d20');
  });

  it('usa o dado do sistema e campos de número', () => {
    expect(
      expressionFor(
        (t) => {
          t.initiative = 'f_for';
          t.checkDice = '2d12';
        },
        { f_for: 3 },
      ),
    ).toBe('2d12+3');
  });

  it('sem campo de iniciativa no sistema, não há rolagem', () => {
    expect(expressionFor(() => {})).toBeNull();
  });
});

describe('iniciativa digitada pelo Mestre', () => {
  it('número é o valor; modificador rola o dado do sistema; rolagem é rolada', () => {
    expect(parseInitiativeInput('15')).toEqual({ kind: 'valor', value: 15 });
    expect(parseInitiativeInput('-2')).toEqual({ kind: 'valor', value: -2 });
    expect(parseInitiativeInput('+3')).toEqual({ kind: 'rolar', expression: '1d20+3' });
    expect(parseInitiativeInput(' + 0 ')).toEqual({ kind: 'rolar', expression: '1d20' });
    expect(parseInitiativeInput('+2', '2d12')).toEqual({ kind: 'rolar', expression: '2d12+2' });
    expect(parseInitiativeInput('1D20 + 4')).toEqual({ kind: 'rolar', expression: '1d20+4' });
  });

  it('recusa o que não é número nem rolagem', () => {
    for (const text of ['', 'goblin', '1d', '+', '1d20+', '9999', 'd0']) {
      expect(parseInitiativeInput(text)).toBeNull();
    }
  });
});
