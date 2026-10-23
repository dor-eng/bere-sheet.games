// Sound effects + vibration. All synthesized with WebAudio (no files, no licences); the context starts on the first tap (browser autoplay rule).
import { prefs } from './prefs.ts';

export type Sfx = 'tap' | 'go' | 'deliver' | 'pump' | 'coin' | 'warn' | 'fine' | 'star' | 'win' | 'lose';
let ctx: AudioContext | null = null, out: GainNode | null = null;

function ac(): AudioContext | null {
  if (ctx) return ctx;
  const C = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!C) return null;
  try { ctx = new C(); out = ctx.createGain(); out.gain.value = 0.5; out.connect(ctx.destination); } catch { ctx = null; }
  return ctx;
}
/** Call from a user gesture: creates/resumes the context so later sounds can play. */
export function unlockAudio() { const c = ac(); if (c && c.state === 'suspended') c.resume().catch(() => {}); }

/** One note: wave, start freq -> end freq (Hz), length (s), delay (s), volume. */
function tone(type: OscillatorType, f0: number, f1: number, len: number, at = 0, vol = 0.3) {
  const c = ac(); if (!c || !out) return;
  const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + len + 0.02);
}
/** Filtered noise burst (pump / whoosh). */
function noise(len: number, freq: number, at = 0, vol = 0.25) {
  const c = ac(); if (!c || !out) return;
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + at;
  f.type = 'bandpass'; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(freq * 2.5, t + len); f.Q.value = 1.2;
  g.gain.value = vol; s.buffer = b; s.connect(f); f.connect(g); g.connect(out); s.start(t);
}

let lastAt: Partial<Record<Sfx, number>> = {};
export function sfx(name: Sfx, delay = 0) {
  if (!prefs.sound || !ctx) return; // ctx exists only after a tap: nothing plays before the player touched the game
  const now = performance.now();
  if (name !== 'star' && now - (lastAt[name] ?? -1e9) < 90) return; // a burst of events = one sound
  lastAt[name] = now;
  const d = delay;
  switch (name) {
    case 'tap': tone('triangle', 660, 520, 0.06, d, 0.12); break;
    case 'go': tone('triangle', 440, 660, 0.12, d, 0.22); tone('triangle', 660, 880, 0.14, d + 0.1, 0.22); break;
    case 'deliver': tone('sine', 180, 90, 0.18, d, 0.35); tone('triangle', 520, 520, 0.05, d + 0.05, 0.1); break;
    case 'pump': noise(0.45, 300, d, 0.22); tone('sine', 120, 70, 0.4, d, 0.12); break;
    case 'coin': tone('square', 988, 988, 0.07, d, 0.08); tone('square', 1319, 1319, 0.18, d + 0.07, 0.08); break;
    case 'warn': tone('triangle', 880, 880, 0.09, d, 0.18); tone('triangle', 880, 880, 0.09, d + 0.16, 0.18); break;
    case 'fine': tone('sawtooth', 220, 140, 0.25, d, 0.12); break;
    case 'star': tone('triangle', 784, 1568, 0.25, d, 0.2); tone('sine', 1568, 1568, 0.3, d + 0.05, 0.08); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.22, d + i * 0.11, 0.22)); break;
    case 'lose': [392, 330, 262].forEach((f, i) => tone('triangle', f, f * 0.97, 0.26, d + i * 0.16, 0.2)); break;
  }
}

export function buzz(ms: number | number[]) { if (prefs.vibe && 'vibrate' in navigator) try { navigator.vibrate(ms); } catch { /* not allowed here */ } }
