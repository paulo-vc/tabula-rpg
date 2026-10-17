import {
  checkExpression,
  listItemValue,
  parseDice,
  type FieldOf,
  type ListItem,
} from '@tabula/domain';
import { DicesIcon, SwordIcon, SwordsIcon } from 'lucide-react';
import { createContext, useContext } from 'react';
import { Button } from '@/components/ui/button';

/** Quem rola os dados da ficha (a sessão ao vivo, ou só um aviso fora dela). */
export interface Roller {
  roll: (label: string, expression: string) => void;
  /**
   * Várias rolagens de uma vez, num aviso só (ex.: "Espada longa": ataque e dano). Cada uma
   * entra no registro como "<title>: <name>".
   */
  rollAll: (title: string, rolls: readonly { name: string; expression: string }[]) => void;
  /** Dado dos testes do sistema ("1d20", "2d12"…). */
  checkDice: string;
}

/** Sem provedor, a ficha não mostra botões de rolar (ex.: cards resumidos). */
export const RollContext = createContext<Roller | null>(null);

/** Botão de rolar uma expressão de dados. Some se a expressão for inválida. */
export function RollButton({ label, expression }: { label: string; expression: string }) {
  const roller = useContext(RollContext);
  if (!roller || !parseDice(expression).ok) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="shrink-0"
      aria-label={`Rolar ${label}`}
      title={`Rolar ${expression}`}
      onClick={() => roller.roll(label, expression)}
    >
      <DicesIcon />
    </Button>
  );
}

/** Botão de teste: o dado do sistema mais o modificador (ex.: 1d20+5). */
export function CheckButton({ label, modifier }: { label: string; modifier: number }) {
  const roller = useContext(RollContext);
  if (!roller) return null;
  return <RollButton label={label} expression={checkExpression(roller.checkDice, modifier)} />;
}

/**
 * Botões de ataque de um item de uma lista de ataques (`attack` no sistema): "Ataque" rola o
 * dado dos testes + o bônus; "Ataque + dano" rola os dois, num aviso só.
 */
export function AttackButtons({
  field,
  item,
  name,
}: {
  field: FieldOf<'list'>;
  item: ListItem;
  /** Nome do item (ex.: "Espada longa"), para o registro e o aviso. */
  name: string;
}) {
  const roller = useContext(RollContext);
  const attack = field.attack;
  if (!roller || !attack) return null;
  const bonusField = field.itemFields.find((f) => f.id === attack.bonus);
  const damageField = field.itemFields.find((f) => f.id === attack.damage);
  const bonus = bonusField ? Number(listItemValue(bonusField, item)) || 0 : 0;
  const hit = checkExpression(roller.checkDice, bonus);
  const damage = damageField ? String(listItemValue(damageField, item) ?? '') : '';
  const hasDamage = damage.trim() !== '' && parseDice(damage).ok;
  return (
    <div className="flex shrink-0 gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        aria-label={`Atacar com ${name}`}
        title={`Rolar ${hit}`}
        onClick={() => roller.rollAll(name, [{ name: 'ataque', expression: hit }])}
      >
        <SwordIcon /> Ataque
      </Button>
      {hasDamage && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          aria-label={`Atacar com ${name} e rolar o dano`}
          title={`Rolar ${hit} e ${damage}`}
          onClick={() =>
            roller.rollAll(name, [
              { name: 'ataque', expression: hit },
              { name: 'dano', expression: damage },
            ])
          }
        >
          <SwordsIcon /> Ataque + dano
        </Button>
      )}
    </div>
  );
}
