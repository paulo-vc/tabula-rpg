import {
  BONUS_KIND_LABELS,
  BONUS_KINDS,
  BONUS_LIMIT,
  BONUS_TARGET_LIMIT,
  BonusSchema,
  bonusEffects,
  type Bonus,
  type BonusEffect,
  type BonusKind,
  type CompiledTemplate,
  type FieldDef,
} from '@tabula/domain';
import { PencilIcon, PlusIcon, SparklesIcon, Trash2Icon, XIcon } from 'lucide-react';
import { createContext, useContext, useId, useMemo, useState, type FormEvent } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatNumber } from './format';

/** Efeito dos bônus ativos da ficha aberta, por campo. Sem provedor, nenhum. */
export const BonusContext = createContext<ReadonlyMap<string, BonusEffect>>(new Map());

export function useBonusEffects(bonuses: readonly Bonus[] | undefined) {
  return useMemo(() => bonusEffects(bonuses), [bonuses]);
}

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

/** "+2 Cinto de Força (item) · −1 Maldição da lua (maldição)". */
function describeSources(effect: BonusEffect) {
  return effect.sources
    .map((s) => `${signed(s.value)} ${s.name} (${BONUS_KIND_LABELS[s.kind].toLowerCase()})`)
    .join(' · ');
}

/**
 * Bônus num campo de número: o valor digitado é a base; aqui aparece o valor final, com as
 * origens ao passar o mouse (ex.: "18 com bônus").
 */
export function BonusNote({ field, base }: { field: FieldDef; base: number | undefined }) {
  const effect = useContext(BonusContext).get(field.id);
  if (!effect || base === undefined) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={`${field.label} com bônus: ${formatNumber(base + effect.total)} (${describeSources(effect)})`}
        className={cn(
          'inline-flex items-center gap-1 text-xs font-medium',
          effect.total > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
        )}
      >
        <SparklesIcon className="size-3" />
        {formatNumber(base + effect.total)} com bônus
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{describeSources(effect)}</TooltipContent>
    </Tooltip>
  );
}

/** Marca num campo calculado: o resultado já inclui o bônus; a marca mostra de onde vem. */
export function BonusMark({ field }: { field: FieldDef }) {
  const effect = useContext(BonusContext).get(field.id);
  if (!effect) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={`${field.label} inclui bônus: ${describeSources(effect)}`}
        className={cn(
          'inline-flex items-center text-xs font-medium',
          effect.total > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
        )}
      >
        <SparklesIcon className="size-3" />
        {signed(effect.total)}
      </TooltipTrigger>
      <TooltipContent className="max-w-64">Inclui: {describeSources(effect)}</TooltipContent>
    </Tooltip>
  );
}

/** Campos que podem receber bônus: números e calculados, à vista de quem edita. */
export function bonusTargets(compiled: CompiledTemplate): FieldDef[] {
  return compiled.template.fields
    .filter((f) => (f.type === 'number' || f.type === 'computed') && f.visibility !== 'gm')
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Botão "Bônus" da ficha, com a lista de bônus num diálogo. */
export function BonusesButton({
  compiled,
  bonuses,
  onChange,
  newId,
}: {
  compiled: CompiledTemplate;
  bonuses: readonly Bonus[];
  onChange: (bonuses: Bonus[]) => void;
  newId: () => string;
}) {
  const [open, setOpen] = useState(false);
  const active = bonuses.filter((b) => b.active).length;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={active > 0 ? `Bônus (${active} ${active === 1 ? 'ativo' : 'ativos'})` : 'Bônus'}
        onClick={() => setOpen(true)}
      >
        <SparklesIcon /> Bônus
        {active > 0 && (
          <Badge variant="secondary" className="tabular-nums">
            {active}
          </Badge>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Bônus e efeitos</DialogTitle>
            <DialogDescription>
              Itens, maldições e bênçãos que mudam valores da ficha. Um bônus em Força muda também o
              modificador e o que usa Força.
            </DialogDescription>
          </DialogHeader>
          <BonusList compiled={compiled} bonuses={bonuses} onChange={onChange} newId={newId} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function BonusList({
  compiled,
  bonuses,
  onChange,
  newId,
}: {
  compiled: CompiledTemplate;
  bonuses: readonly Bonus[];
  onChange: (bonuses: Bonus[]) => void;
  newId: () => string;
}) {
  const [editing, setEditing] = useState<Bonus | null>(null);
  const labelOf = (fieldId: string) => compiled.fieldsById.get(fieldId)?.label ?? fieldId;
  const save = (bonus: Bonus) => {
    const exists = bonuses.some((b) => b.id === bonus.id);
    onChange(exists ? bonuses.map((b) => (b.id === bonus.id ? bonus : b)) : [...bonuses, bonus]);
    setEditing(null);
  };

  if (editing) {
    return (
      <BonusForm
        compiled={compiled}
        initial={editing}
        onSave={save}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      {bonuses.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhum bônus ainda.</p>
      ) : (
        <ul aria-label="Bônus da ficha" className="space-y-2">
          {bonuses.map((bonus) => (
            <li key={bonus.id} className="flex items-start gap-2 rounded-md border px-3 py-2">
              <Checkbox
                className="mt-0.5"
                checked={bonus.active}
                aria-label={`${bonus.name} ativo`}
                onCheckedChange={(checked) =>
                  onChange(
                    bonuses.map((b) =>
                      b.id === bonus.id ? { ...b, active: checked === true } : b,
                    ),
                  )
                }
              />
              <div className={cn('min-w-0 flex-1 text-sm', !bonus.active && 'opacity-60')}>
                <p className="font-medium">
                  {bonus.name}{' '}
                  <span className="text-muted-foreground font-normal">
                    ({BONUS_KIND_LABELS[bonus.kind].toLowerCase()})
                  </span>
                </p>
                <p className="text-muted-foreground text-xs">
                  {bonus.targets.map((t) => `${labelOf(t.fieldId)} ${signed(t.value)}`).join(', ')}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={`Editar ${bonus.name}`}
                onClick={() => setEditing(bonus)}
              >
                <PencilIcon />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={`Remover ${bonus.name}`}
                onClick={() => onChange(bonuses.filter((b) => b.id !== bonus.id))}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={bonuses.length >= BONUS_LIMIT}
        onClick={() =>
          setEditing({
            id: newId(),
            name: '',
            kind: 'item',
            active: true,
            targets: [{ fieldId: '', value: 1 }],
          })
        }
      >
        <PlusIcon /> Adicionar bônus
      </Button>
    </div>
  );
}

function BonusForm({
  compiled,
  initial,
  onSave,
  onCancel,
}: {
  compiled: CompiledTemplate;
  initial: Bonus;
  onSave: (bonus: Bonus) => void;
  onCancel: () => void;
}) {
  const base = useId();
  const [name, setName] = useState(initial.name);
  const [kind, setKind] = useState<BonusKind>(initial.kind);
  const [targets, setTargets] = useState(
    initial.targets.map((t) => ({ fieldId: t.fieldId, value: String(t.value) })),
  );
  const fields = bonusTargets(compiled);
  const candidate: Bonus = {
    ...initial,
    name: name.trim(),
    kind,
    // Aceita o sinal de menos tipográfico (−2), comum em teclados de celular.
    targets: targets.map((t) => ({
      fieldId: t.fieldId,
      value: Number(t.value.trim().replace('−', '-')),
    })),
  };
  const valid =
    BonusSchema.safeParse(candidate).success &&
    candidate.targets.every((t) => compiled.fieldsById.has(t.fieldId));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onSave(candidate);
  };
  const setTarget = (index: number, change: Partial<{ fieldId: string; value: string }>) =>
    setTargets((current) => current.map((t, i) => (i === index ? { ...t, ...change } : t)));

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Bônus">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor={`${base}-nome`}>Nome</Label>
          <Input
            id={`${base}-nome`}
            value={name}
            maxLength={100}
            placeholder="ex.: Cinto de Força"
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${base}-origem`}>Origem</Label>
          <select
            id={`${base}-origem`}
            value={kind}
            onChange={(event) => setKind(event.target.value as BonusKind)}
            className="border-input dark:bg-input/30 h-8 w-full rounded-lg border bg-transparent px-2 text-sm"
          >
            {BONUS_KINDS.map((k) => (
              <option key={k} value={k}>
                {BONUS_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium">O que muda</legend>
        {targets.map((target, index) => (
          <div key={index} className="flex items-center gap-2">
            <select
              aria-label={`Campo ${index + 1}`}
              value={target.fieldId}
              onChange={(event) => setTarget(index, { fieldId: event.target.value })}
              className="border-input dark:bg-input/30 h-8 min-w-0 flex-1 rounded-lg border bg-transparent px-2 text-sm"
            >
              <option value="">Escolha o campo…</option>
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.label}
                </option>
              ))}
            </select>
            <Input
              aria-label={`Valor ${index + 1}`}
              inputMode="numeric"
              value={target.value}
              className="h-8 w-20 text-center tabular-nums"
              onChange={(event) => setTarget(index, { value: event.target.value })}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={`Tirar o campo ${index + 1}`}
              disabled={targets.length === 1}
              onClick={() => setTargets((current) => current.filter((_, i) => i !== index))}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={targets.length >= BONUS_TARGET_LIMIT}
          onClick={() => setTargets((current) => [...current, { fieldId: '', value: '1' }])}
        >
          <PlusIcon /> Outro campo
        </Button>
        <p className="text-muted-foreground text-xs">
          Valores inteiros: positivos para bônus, negativos para penalidades (ex.: −2).
        </p>
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!valid}>
          Salvar bônus
        </Button>
      </div>
    </form>
  );
}
