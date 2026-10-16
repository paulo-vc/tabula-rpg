import type { SoundCue } from '@tabula/domain';

/** Toca um aviso sonoro (injetável: nos testes, um que só anota). */
export interface SoundPlayer {
  play(cue: SoundCue, volume: number): void;
}

/** Uma nota: frequência (Hz), início e duração (s) e volume relativo. */
interface Note {
  frequency: number;
  at: number;
  duration: number;
  gain: number;
  wave: OscillatorType;
}

const NOTES: Record<Exclude<SoundCue, 'rolagem'>, Note[]> = {
  // Duas notas subindo: chama a atenção sem assustar.
  'sua-vez': [
    { frequency: 660, at: 0, duration: 0.16, gain: 0.5, wave: 'triangle' },
    { frequency: 880, at: 0.14, duration: 0.28, gain: 0.5, wave: 'triangle' },
  ],
  mensagem: [{ frequency: 740, at: 0, duration: 0.09, gain: 0.25, wave: 'sine' }],
  // Duas notas suaves descendo, mais longas.
  sussurro: [
    { frequency: 988, at: 0, duration: 0.22, gain: 0.22, wave: 'sine' },
    { frequency: 740, at: 0.16, duration: 0.32, gain: 0.22, wave: 'sine' },
  ],
};

/** Batidas curtas de ruído: dados rolando na mesa. */
const DICE_HITS = [0, 0.07, 0.15, 0.26];

/**
 * Sons gerados na hora (Web Audio), sem arquivos: funcionam igual na web e no desktop.
 * Navegadores só liberam o áudio depois de um toque ou tecla na página; até lá, os avisos
 * ficam em silêncio.
 */
export function createWebAudioPlayer(): SoundPlayer {
  let context: AudioContext | undefined;
  const ensure = (): AudioContext | undefined => {
    if (typeof AudioContext === 'undefined') return undefined;
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    return context;
  };
  // O primeiro gesto libera o áudio para os avisos seguintes.
  if (typeof window !== 'undefined') {
    const unlock = () => {
      ensure();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  return {
    play(cue, volume) {
      const audio = ensure();
      if (!audio || audio.state !== 'running' || volume <= 0) return;
      const start = audio.currentTime + 0.01;
      if (cue === 'rolagem') {
        for (const at of DICE_HITS) hit(audio, start + at, volume);
        return;
      }
      for (const note of NOTES[cue]) tone(audio, start, note, volume);
    },
  };
}

function tone(audio: AudioContext, start: number, note: Note, volume: number): void {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = note.wave;
  oscillator.frequency.value = note.frequency;
  const begin = start + note.at;
  const peak = note.gain * volume;
  gain.gain.setValueAtTime(0, begin);
  gain.gain.linearRampToValueAtTime(peak, begin + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, begin + note.duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(begin);
  oscillator.stop(begin + note.duration + 0.02);
}

function hit(audio: AudioContext, at: number, volume: number): void {
  const length = Math.floor(audio.sampleRate * 0.04);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2200;
  const gain = audio.createGain();
  gain.gain.value = 0.6 * volume;
  source.connect(filter).connect(gain).connect(audio.destination);
  source.start(at);
}
