import { useLiveQuery } from 'dexie-react-hooks';
import { PlusIcon } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import { useServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

const BLANK = '__branco';

/** Começa um sistema novo: em branco ou como cópia de outro (ex.: uma variante do D&D). */
export function NewSystemDialog() {
  const { catalog, editor } = useServices();
  const templates = useLiveQuery(() => catalog.list(), [catalog]);
  const [, navigate] = useLocation();
  const base = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [from, setFrom] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || (from === BLANK && !name.trim())) return;
    setBusy(true);
    try {
      const draft =
        from === BLANK ? await editor.createBlank(name.trim()) : await editor.createCopy(from);
      setOpen(false);
      navigate(`/sistemas/editor/${draft.id}`);
    } catch (error) {
      toast.error('Não foi possível criar o sistema', { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon /> Criar sistema
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Criar sistema</DialogTitle>
            <DialogDescription>
              Comece do zero ou a partir de um sistema que você já tem.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${base}-base`}>Começar</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger id={`${base}-base`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BLANK}>Em branco</SelectItem>
                {templates?.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    Cópia de {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {from === BLANK && (
            <div className="space-y-1.5">
              <Label htmlFor={`${base}-nome`}>Nome do sistema</Label>
              <Input
                id={`${base}-nome`}
                value={name}
                maxLength={100}
                autoFocus
                placeholder="Ex.: Minha Fantasia"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={busy || (from === BLANK && !name.trim())}>
              Começar a editar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
