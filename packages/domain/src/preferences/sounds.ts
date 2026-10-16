import { z } from 'zod';

/** Avisos sonoros do app. */
export const SOUND_CUES = ['sua-vez', 'rolagem', 'mensagem', 'sussurro'] as const;
export type SoundCue = (typeof SOUND_CUES)[number];

/** Preferências de som deste aparelho. */
export const SoundSettingsSchema = z.object({
  enabled: z.boolean(),
  /** De 0 a 1. */
  volume: z.number().min(0).max(1),
});
export type SoundSettings = z.infer<typeof SoundSettingsSchema>;

/** Ligados, a meio volume: avisam sem assustar. Dá para desligar no cabeçalho. */
export const DEFAULT_SOUND_SETTINGS: SoundSettings = { enabled: true, volume: 0.5 };
