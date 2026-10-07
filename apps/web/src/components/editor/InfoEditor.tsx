import { bumpVersion, type SystemTemplate, type VersionBump } from '@tabula/domain';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ApplyChange } from './use-template-editor';

type Apply = ApplyChange;

const LICENSES = ['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0', 'OGL-1.0a', 'ORC', 'MIT'];

/** Atualiza uma propriedade opcional, removendo-a quando fica vazia. */
function setOptional<K extends 'description' | 'author' | 'license' | 'language'>(
  template: SystemTemplate,
  key: K,
  value: string,
): SystemTemplate {
  const { [key]: _, ...rest } = template;
  return (value ? { ...rest, [key]: value } : rest) as SystemTemplate;
}

export function InfoEditor({
  template,
  apply,
  idEditable,
  savedVersion,
}: {
  template: SystemTemplate;
  apply: Apply;
  /** Só sistemas nunca salvos podem trocar de identificador (fichas dependem dele). */
  idEditable: boolean;
  savedVersion: string | undefined;
}) {
  const base = useId();
  const bump = (kind: VersionBump) =>
    apply((t) => ({ ...t, version: bumpVersion(savedVersion ?? t.version, kind) }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${base}-nome`}>Nome do sistema</Label>
          <Input
            id={`${base}-nome`}
            value={template.name}
            maxLength={100}
            onChange={(event) => apply((t) => ({ ...t, name: event.target.value }), 'nome')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${base}-autor`}>Autor</Label>
          <Input
            id={`${base}-autor`}
            value={template.author ?? ''}
            maxLength={100}
            onChange={(event) =>
              apply((t) => setOptional(t, 'author', event.target.value), 'autor')
            }
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${base}-descricao`}>Descrição</Label>
        <Textarea
          id={`${base}-descricao`}
          rows={3}
          maxLength={2000}
          value={template.description ?? ''}
          onChange={(event) =>
            apply((t) => setOptional(t, 'description', event.target.value), 'descricao')
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${base}-licenca`}>Licença</Label>
          <Input
            id={`${base}-licenca`}
            list={`${base}-licencas`}
            value={template.license ?? ''}
            maxLength={100}
            placeholder="Necessária para publicar"
            onChange={(event) =>
              apply((t) => setOptional(t, 'license', event.target.value), 'licenca')
            }
          />
          <datalist id={`${base}-licencas`}>
            {LICENSES.map((license) => (
              <option key={license} value={license} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${base}-etiquetas`}>Etiquetas (separadas por vírgula)</Label>
          <Input
            id={`${base}-etiquetas`}
            value={template.tags?.join(', ') ?? ''}
            placeholder="fantasia, horror…"
            onChange={(event) =>
              apply((t) => {
                const tags = event.target.value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean)
                  .slice(0, 10);
                const { tags: _, ...rest } = t;
                return tags.length > 0 ? { ...rest, tags } : rest;
              }, 'etiquetas')
            }
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${base}-id`}>Identificador</Label>
          <Input
            id={`${base}-id`}
            value={template.id}
            readOnly={!idEditable}
            maxLength={64}
            className="font-mono"
            onChange={(event) => apply((t) => ({ ...t, id: event.target.value }), 'id')}
          />
          <p className="text-muted-foreground text-xs">
            {idEditable
              ? 'Único entre os sistemas. Não pode mudar depois de salvo.'
              : 'Fichas e campanhas dependem dele; não pode mudar.'}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Versão</Label>
          <p className="font-mono text-sm">{template.version}</p>
          {savedVersion ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => bump('minor')}>
                Novidades ({bumpVersion(savedVersion, 'minor')})
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => bump('major')}>
                Mudança grande ({bumpVersion(savedVersion, 'major')})
              </Button>
            </div>
          ) : null}
          <p className="text-muted-foreground text-xs">
            Ao salvar uma alteração, a versão de correção aumenta sozinha. Use "Mudança grande"
            quando campos forem removidos ou mudarem de sentido: quem usa o sistema confirma a
            atualização das fichas.
          </p>
        </div>
      </div>
    </div>
  );
}
