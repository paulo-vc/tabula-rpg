import { useLiveQuery } from 'dexie-react-hooks';
import { PlusIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
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

export function NewSheetDialog() {
  const { catalog, sheets } = useServices();
  const templates = useLiveQuery(() => catalog.list(), [catalog]);
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = templateId || templates?.[0]?.id || '';
  const canCreate = name.trim() !== '' && selected !== '' && !busy;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    try {
      const sheet = await sheets.create({ name, templateId: selected });
      setOpen(false);
      setName('');
      navigate(`/fichas/${sheet.id}`);
    } catch (error) {
      toast.error('Não foi possível criar a ficha', { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon /> Nova ficha
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nova ficha</DialogTitle>
            <DialogDescription>Escolha o sistema e dê um nome ao personagem.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="nova-ficha-nome">Nome do personagem</Label>
            <Input
              id="nova-ficha-nome"
              value={name}
              maxLength={100}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nova-ficha-sistema">Sistema</Label>
            <Select value={selected} onValueChange={setTemplateId}>
              <SelectTrigger id="nova-ficha-sistema" className="w-full">
                <SelectValue placeholder="Escolha um sistema" />
              </SelectTrigger>
              <SelectContent>
                {templates?.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!canCreate}>
              Criar ficha
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
