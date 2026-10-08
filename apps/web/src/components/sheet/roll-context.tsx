import { checkExpression, parseDice } from '@tabula/domain';
import { DicesIcon } from 'lucide-react';
import { createContext, useContext } from 'react';
import { Button } from '@/components/ui/button';

/** Quem rola os dados da ficha (a sessão ao vivo, ou só um aviso fora dela). */
export interface Roller {
  roll: (label: string, expression: string) => void;
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
