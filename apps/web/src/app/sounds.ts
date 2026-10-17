import type { DeviceRepository, SoundCue, SoundSettings } from '@tabula/domain';
import type { SoundPlayer } from '@/lib/sounds';

/** Avisos sonoros, conforme as preferências deste aparelho. */
/** O mesmo aviso repetido em menos que isso toca uma vez só (ex.: ataque e dano juntos). */
const REPEAT_GAP_MS = 250;

export class SoundService {
  private readonly lastPlayed = new Map<SoundCue, number>();

  constructor(
    private readonly device: DeviceRepository,
    private readonly player: SoundPlayer,
    private readonly now: () => number = () => Date.now(),
  ) {}

  settings(): Promise<SoundSettings> {
    return this.device.getSoundSettings();
  }

  async update(changes: Partial<SoundSettings>): Promise<void> {
    await this.device.setSoundSettings({ ...(await this.settings()), ...changes });
  }

  /** Toca o aviso, se os sons estão ligados. */
  async play(cue: SoundCue): Promise<void> {
    const at = this.now();
    const last = this.lastPlayed.get(cue);
    if (last !== undefined && at - last < REPEAT_GAP_MS) return;
    this.lastPlayed.set(cue, at);
    // Um aviso sonoro nunca derruba nada: sem acesso às preferências (ex.: o banco foi
    // fechado ao sair), fica em silêncio.
    try {
      const { enabled, volume } = await this.settings();
      if (enabled) this.player.play(cue, volume);
    } catch {
      // silêncio
    }
  }

  /** "Testar": toca no volume escolhido, mesmo com os sons desligados. */
  async test(volume?: number): Promise<void> {
    this.player.play('sua-vez', volume ?? (await this.settings()).volume);
  }
}
