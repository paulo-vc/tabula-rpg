import type { DeviceRepository, SoundCue, SoundSettings } from '@tabula/domain';
import type { SoundPlayer } from '@/lib/sounds';

/** Avisos sonoros, conforme as preferências deste aparelho. */
export class SoundService {
  constructor(
    private readonly device: DeviceRepository,
    private readonly player: SoundPlayer,
  ) {}

  settings(): Promise<SoundSettings> {
    return this.device.getSoundSettings();
  }

  async update(changes: Partial<SoundSettings>): Promise<void> {
    await this.device.setSoundSettings({ ...(await this.settings()), ...changes });
  }

  /** Toca o aviso, se os sons estão ligados. */
  async play(cue: SoundCue): Promise<void> {
    const { enabled, volume } = await this.settings();
    if (enabled) this.player.play(cue, volume);
  }

  /** "Testar": toca no volume escolhido, mesmo com os sons desligados. */
  async test(volume?: number): Promise<void> {
    this.player.play('sua-vez', volume ?? (await this.settings()).volume);
  }
}
