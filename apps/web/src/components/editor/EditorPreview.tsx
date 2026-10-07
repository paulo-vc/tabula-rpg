import {
  computeDerived,
  defaultValue,
  type CompiledTemplate,
  type FieldValue,
  type SheetValues,
  valueProblem,
} from '@tabula/domain';
import { useMemo, useState } from 'react';
import { SheetLayout } from '@/components/sheet/SheetLayout';

/**
 * Ficha de teste do sistema em edição. Os valores digitados aqui servem só para
 * experimentar as fórmulas e não são salvos.
 */
export function EditorPreview({ compiled, stale }: { compiled: CompiledTemplate; stale: boolean }) {
  const [edited, setEdited] = useState<SheetValues>({});

  // Campos novos ganham o valor inicial; os já editados mantêm o valor de teste.
  const values = useMemo(() => {
    const result: SheetValues = {};
    for (const field of compiled.template.fields) {
      // Um valor de teste de antes de o campo mudar de tipo deixa de valer.
      const tested = edited[field.id];
      const value =
        tested !== undefined && valueProblem(field, tested) === undefined
          ? tested
          : defaultValue(field);
      if (value !== undefined) result[field.id] = value;
    }
    return result;
  }, [compiled, edited]);
  const derived = useMemo(() => computeDerived(compiled, values), [compiled, values]);

  return (
    <div className="space-y-3">
      {stale && (
        <p
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm"
          role="status"
        >
          A prévia mostra a última versão sem problemas. Corrija os campos marcados para
          atualizá-la.
        </p>
      )}
      <SheetLayout
        compiled={compiled}
        values={values}
        derived={derived}
        onChange={(fieldId: string, value: FieldValue) =>
          setEdited((current) => ({ ...current, [fieldId]: value }))
        }
        newItemId={() => crypto.randomUUID()}
      />
    </div>
  );
}
