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

/**
 * Dados na mesa: dois dados, cada um quicando com intervalos e força cada vez menores, como
 * um dado de verdade perdendo energia.
 */
const DICE_BOUNCES = [
  { at: 0, gain: 1 },
  { at: 0.09, gain: 0.7 },
  { at: 0.16, gain: 0.5 },
  { at: 0.21, gain: 0.35 },
  { at: 0.245, gain: 0.22 },
  { at: 0.27, gain: 0.12 },
];
const SECOND_DIE_DELAY = 0.035;

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
        for (const delay of [0, SECOND_DIE_DELAY]) {
          for (const bounce of DICE_BOUNCES) {
            hit(audio, start + delay + bounce.at, volume * bounce.gain);
          }
        }
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

/** Um quique: estalo curto de plástico (ruído filtrado) com um leve baque da mesa. */
function hit(audio: AudioContext, at: number, volume: number): void {
  const length = Math.floor(audio.sampleRate * 0.025);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const samples = buffer.getChannelData(0);
  // Decaimento rápido: o estalo é quase só o ataque.
  for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  // Cada quique soa um pouco diferente (o dado cai em outra face).
  filter.frequency.value = 2400 + Math.random() * 1600;
  filter.Q.value = 1.4;
  const gain = audio.createGain();
  gain.gain.value = 0.9 * volume;
  source.connect(filter).connect(gain).connect(audio.destination);
  source.start(at);

  const thud = audio.createOscillator();
  const thudGain = audio.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(190, at);
  thud.frequency.exponentialRampToValueAtTime(90, at + 0.05);
  thudGain.gain.setValueAtTime(0.25 * volume, at);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
  thud.connect(thudGain).connect(audio.destination);
  thud.start(at);
  thud.stop(at + 0.07);
}
