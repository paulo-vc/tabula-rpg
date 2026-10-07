import {
  issuesByField,
  type CompiledTemplate,
  type Issue,
  type SystemTemplate,
  type TemplateDraft,
  validateTemplate,
} from '@tabula/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServices } from '@/app/services-context';

const HISTORY_LIMIT = 100;
const SAVE_DELAY_MS = 400;
/** Alterações seguidas do mesmo grupo (ex.: digitar um título) viram um passo só de desfazer. */
const GROUP_WINDOW_MS = 1500;

interface History {
  past: SystemTemplate[];
  present: SystemTemplate;
  future: SystemTemplate[];
  /** Grupo da última alteração, para juntar as seguintes. */
  group?: { key: string; at: number } | undefined;
}

/** Função que altera o template; `group` junta alterações seguidas num passo de desfazer. */
export type ApplyChange = (
  change: (template: SystemTemplate) => SystemTemplate,
  group?: string,
) => void;

export type EditorState =
  { status: 'carregando' } | { status: 'inexistente' } | { status: 'pronto'; draft: TemplateDraft };

/**
 * Estado do criador de sistemas: o template em edição, com desfazer/refazer, gravado no
 * rascunho logo após cada alteração (nada se perde se a aba fechar).
 */
export function useTemplateEditor(draftId: string) {
  const { editor } = useServices();
  const [state, setState] = useState<EditorState>({ status: 'carregando' });
  const [history, setHistory] = useState<History | null>(null);
  const pending = useRef<SystemTemplate | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void editor.get(draftId).then((draft) => {
      if (!active) return;
      if (!draft) {
        setState({ status: 'inexistente' });
        return;
      }
      setState({ status: 'pronto', draft });
      setHistory({ past: [], present: draft.template, future: [] });
    });
    return () => {
      active = false;
    };
  }, [editor, draftId]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const template = pending.current;
    pending.current = null;
    if (template) await editor.update(draftId, template);
  }, [editor, draftId]);

  // Grava o que faltar ao sair da tela. Sem ninguém para avisar, uma falha aqui (ex.: banco
  // já fechado) só perde a última fração de segundo de edição.
  useEffect(
    () => () => {
      flush().catch(() => {});
    },
    [flush],
  );

  const persist = useCallback(
    (template: SystemTemplate) => {
      pending.current = template;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const apply: ApplyChange = useCallback(
    (change, group) => {
      const now = Date.now();
      setHistory((current) => {
        if (!current) return current;
        const next = change(current.present);
        if (next === current.present) return current;
        persist(next);
        const sameGroup =
          group !== undefined &&
          current.group?.key === group &&
          now - current.group.at < GROUP_WINDOW_MS;
        return {
          past: sameGroup ? current.past : [...current.past, current.present].slice(-HISTORY_LIMIT),
          present: next,
          future: [],
          group: group === undefined ? undefined : { key: group, at: now },
        };
      });
    },
    [persist],
  );

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current?.past.at(-1);
      if (!current || !previous) return current;
      persist(previous);
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
  }, [persist]);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current?.future[0];
      if (!current || !next) return current;
      persist(next);
      return {
        past: [...current.past, current.present],
        present: next,
        future: current.future.slice(1),
      };
    });
  }, [persist]);

  const template = history?.present;
  const validation = useMemo(() => {
    if (!template) return null;
    const result = validateTemplate(template);
    const issues: Issue[] = result.ok ? [] : result.error;
    return {
      compiled: result.ok ? result.value : null,
      issues,
      ...issuesByField(template, issues),
    };
  }, [template]);

  // Prévia: a última versão válida continua visível enquanto o rascunho tem problemas.
  const [lastValid, setLastValid] = useState<CompiledTemplate | null>(null);
  if (validation?.compiled && validation.compiled !== lastValid) setLastValid(validation.compiled);

  return {
    state,
    template,
    validation,
    preview: validation?.compiled ?? lastValid,
    apply,
    undo,
    redo,
    canUndo: (history?.past.length ?? 0) > 0,
    canRedo: (history?.future.length ?? 0) > 0,
    flush,
  };
}
