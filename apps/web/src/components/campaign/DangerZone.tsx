import type { Campaign } from '@tabula/domain';
import { useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useServices } from '@/app/services-context';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** Apagar a campanha deste aparelho (o Mestre exclui; o jogador sai), com confirmação. */
export function DangerZone({
  campaign,
  title,
  description,
  action,
  icon,
}: {
  campaign: Campaign;
  title: string;
  description: string;
  action: string;
  icon: ReactNode;
}) {
  const { campaigns } = useServices();
  const [, navigate] = useLocation();
  const [confirm, setConfirm] = useState(false);
  return (
    <div>
      <Button variant="ghost" className="text-destructive" onClick={() => setConfirm(true)}>
        {icon} {title}
      </Button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {title}: "{campaign.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                await campaigns.delete(campaign.id);
                navigate('/campanhas');
              }}
            >
              {action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
