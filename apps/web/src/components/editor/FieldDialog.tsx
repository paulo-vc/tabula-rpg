import {
  FIELD_TYPE_LABELS,
  issuesByField,
  KeySchema,
  nodeAt,
  pathOfField,
  setFieldSpan,
  setInGmSummary,
  updateField,
  validateTemplate,
  withType,
  type Columns,
  type FieldDef,
  type FieldType,
  type SystemTemplate,
} from '@tabula/domain';
import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FieldProperties } from './FieldProperties';
import { describeIssue } from './issues';

const SPAN_LABELS: Record<string, string> = {
  auto: 'Automática',
  '1': '1 coluna',
  '2': '2 colunas',
  '3': '3 colunas',
  '4': '4 colunas',
};

interface Settings {
  field: FieldDef;
  inSummary: boolean;
  span: Columns | undefined;
}

function settingsOf(template: SystemTemplate, fieldId: string): Settings | null {
  const field = template.fields.find((f) => f.id === fieldId);
  if (!field) return null;
  const path = pathOfField(template.layouts.full, fieldId);
  const node = path ? nodeAt(template.layouts.full, path) : undefined;
  return {
    field,
    inSummary: template.layouts.gmSummary?.includes(fieldId) ?? false,
    span: node?.kind === 'field' ? node.span : undefined,
  };
}

/** Aplica as configurações do diálogo ao template. */
function applySettings(template: SystemTemplate, settings: Settings): SystemTemplate {
  let next = updateField(template, settings.field);
  next = setInGmSummary(next, settings.field.id, settings.inSummary);
  return setFieldSpan(next, settings.field.id, settings.span);
}

/**
 * Edição de um campo. As alterações valem só ao confirmar; os problemas aparecem enquanto
 * o usuário digita (o template é validado com a versão em edição do campo).
 */
export function FieldDialog({
  template,
  fieldId,
  onApply,
  onClose,
}: {
  template: SystemTemplate;
  fieldId: string | null;
  onApply: (change: (template: SystemTemplate) => SystemTemplate) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={fieldId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {fieldId && (
          <FieldForm
            key={fieldId}
            template={template}
            fieldId={fieldId}
            onApply={(change) => {
              onApply(change);
              onClose();
            }}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FieldForm({
  template,
  fieldId,
  onApply,
  onCancel,
}: {
  template: SystemTemplate;
  fieldId: string;
  onApply: (change: (template: SystemTemplate) => SystemTemplate) => void;
  onCancel: () => void;
}) {
  const base = useId();
  const [settings, setSettings] = useState(() => settingsOf(template, fieldId));

  const problems = useMemo(() => {
    if (!settings) return [];
    const candidate = applySettings(template, settings);
    const result = validateTemplate(candidate);
    if (result.ok) return [];
    return issuesByField(candidate, result.error).byField.get(fieldId) ?? [];
  }, [template, settings, fieldId]);

  if (!settings) return null;
  const { field } = settings;
  const change = (next: Partial<Settings>) => setSettings({ ...settings, ...next });
  const changeField = (next: FieldDef) => change({ field: next });
  const keyError = KeySchema.safeParse(field.key).success
    ? undefined
    : 'Use letras minúsculas, números e _ (começando por letra).';
  const formulaInvalid = problems.some((p) => p.path.includes('formula') || p.path.includes('max'));

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onApply((current) => applySettings(current, settings));
      }}
    >
      <DialogHeader>
        <DialogTitle>{field.label || 'Campo sem nome'}</DialogTitle>
        <DialogDescription>{FIELD_TYPE_LABELS[field.type]}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${base}-rotulo`}>Nome na ficha</Label>
          <Input
            id={`${base}-rotulo`}
            value={field.label}
            maxLength={100}
            onChange={(event) => changeField({ ...field, label: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${base}-apelido`}>Apelido nas fórmulas</Label>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground font-mono">@</span>
            <Input
              id={`${base}-apelido`}
              value={field.key}
              maxLength={40}
              aria-invalid={keyError !== undefined}
              className="font-mono"
              onChange={(event) => changeField({ ...field, key: event.target.value.toLowerCase() })}
            />
          </div>
          {keyError && <p className="text-destructive text-xs">{keyError}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${base}-tipo`}>Tipo</Label>
          <Select
            value={field.type}
            onValueChange={(type) => changeField(withType(field, type as FieldType))}
          >
            <SelectTrigger id={`${base}-tipo`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((type) => (
                <SelectItem key={type} value={type}>
                  {FIELD_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${base}-largura`}>Largura na seção</Label>
          <Select
            value={settings.span === undefined ? 'auto' : String(settings.span)}
            onValueChange={(value) =>
              change({ span: value === 'auto' ? undefined : (Number(value) as Columns) })
            }
          >
            <SelectTrigger id={`${base}-largura`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SPAN_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${base}-ajuda`}>Texto de ajuda (opcional)</Label>
        <Textarea
          id={`${base}-ajuda`}
          rows={2}
          maxLength={2000}
          value={field.description ?? ''}
          onChange={(event) => {
            const { description: _, ...rest } = field;
            changeField(
              event.target.value
                ? { ...field, description: event.target.value }
                : (rest as FieldDef),
            );
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${base}-mestre`}
            checked={field.visibility === 'gm'}
            onCheckedChange={(checked) => {
              const { visibility: _, ...rest } = field;
              changeField(checked === true ? { ...field, visibility: 'gm' } : (rest as FieldDef));
            }}
          />
          <Label htmlFor={`${base}-mestre`} className="font-normal">
            Visível só para o Mestre durante a sessão
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${base}-resumo`}
            checked={settings.inSummary}
            onCheckedChange={(checked) => change({ inSummary: checked === true })}
          />
          <Label htmlFor={`${base}-resumo`} className="font-normal">
            Mostrar no card do jogador no painel do Mestre
          </Label>
        </div>
      </div>

      <div className="border-t pt-4">
        <FieldProperties
          field={field}
          fields={template.fields}
          formulaInvalid={formulaInvalid}
          onChange={(next) => changeField(next as FieldDef)}
        />
      </div>

      {problems.length > 0 && (
        <ul
          className="border-destructive/40 bg-destructive/5 text-destructive space-y-1 rounded-md border p-3 text-sm"
          aria-label="Problemas do campo"
        >
          {problems.map((problem, index) => (
            <li key={index}>{describeIssue(template, problem)}</li>
          ))}
        </ul>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">Aplicar</Button>
      </DialogFooter>
    </form>
  );
}
