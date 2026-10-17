import { DEFAULT_SOUND_SETTINGS, type DeviceRepository, type SoundCue } from '@tabula/domain';
import { describe, expect, it } from 'vitest';
import { SoundService } from './sounds';

function setUp() {
  let settings = DEFAULT_SOUND_SETTINGS;
  const device = {
    getSoundSettings: async () => settings,
    setSoundSettings: async (next: typeof settings) => {
      settings = next;
    },
  } as unknown as DeviceRepository;
  const played: SoundCue[] = [];
  let now = 1000;
  const service = new SoundService(device, { play: (cue) => played.push(cue) }, () => now);
  return { service, played, advance: (ms: number) => (now += ms) };
}

describe('SoundService', () => {
  it('o mesmo aviso repetido em seguida toca uma vez só (ex.: ataque e dano juntos)', async () => {
    const { service, played, advance } = setUp();
    await service.play('rolagem');
    await service.play('rolagem');
    advance(100);
    await service.play('rolagem');
    await service.play('mensagem'); // outro aviso: toca
    advance(300);
    await service.play('rolagem');
    expect(played).toEqual(['rolagem', 'mensagem', 'rolagem']);
  });

  it('desligados, não tocam', async () => {
    const { service, played } = setUp();
    await service.update({ enabled: false });
    await service.play('rolagem');
    expect(played).toEqual([]);
  });
});
