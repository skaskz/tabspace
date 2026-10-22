// Synthesizes the promo's music bed and sound effects as 16-bit WAV files (original, license-free).
// Usage: node scripts/make-audio.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SR = 44100;
const out = resolve(import.meta.dirname, '..', 'public', 'audio');
mkdirSync(out, { recursive: true });

let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function writeWav(name, left, right = left) {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const g = peak > 0.98 ? 0.98 / peak : 1;
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] * g)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] * g)) * 32767), 46 + i * 4);
  }
  writeFileSync(resolve(out, name), buf);
  console.log(name, (n / SR).toFixed(2) + 's');
}

const arr = (sec) => new Float32Array(Math.round(sec * SR));
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

// State-variable filter (Chamberlin) — used for band/low-pass sweeps.
function svf() {
  let low = 0, band = 0;
  return (x, cutoff, q = 0.7) => {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoff, SR / 6)) / SR);
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    return { low, band, high };
  };
}

// Simple stereo feedback delay/"reverb" for space.
function space(l, r, { time = 0.23, fb = 0.35, mix = 0.25 } = {}) {
  const d = Math.round(time * SR);
  const d2 = Math.round(time * 1.37 * SR);
  const ol = Float32Array.from(l), or = Float32Array.from(r);
  for (let i = 0; i < l.length; i++) {
    if (i >= d) ol[i] += ol[i - d] * fb * 0.9 + r[i - d] * mix * 0.4;
    if (i >= d2) or[i] += or[i - d2] * fb * 0.9 + l[i - d2] * mix * 0.4;
  }
  for (let i = 0; i < l.length; i++) {
    ol[i] = l[i] * (1 - mix) + ol[i] * mix;
    or[i] = r[i] * (1 - mix) + or[i] * mix;
  }
  return [ol, or];
}

/* ------------------------------------------------------------------ */
/* Music: 100 BPM ambient electronic bed, ~52 s                        */
/* ------------------------------------------------------------------ */
{
  const BPM = 100;
  const beat = 60 / BPM;
  const bars = 22;
  const len = bars * 4 * beat + 3;
  const L = arr(len), R = arr(len);
  // Am9 – Fmaj7 – Cadd9 – G6 (deep-space, hopeful)
  const chords = [
    [57, 60, 64, 67, 71],
    [53, 57, 60, 64, 69],
    [48, 55, 60, 62, 64],
    [55, 59, 62, 64, 66],
  ];
  const bassNotes = [45, 41, 36, 43];
  const lpL = svf(), lpR = svf();
  const n = L.length;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const barIdx = Math.floor(t / (4 * beat));
    const chord = chords[barIdx % 4];
    const inBar = (t % (4 * beat)) / (4 * beat);
    // pad: detuned saws, slow swell per bar
    let pl = 0, pr = 0;
    for (const m of chord) {
      const f = midi(m);
      for (const det of [-0.12, 0.11]) {
        const ph = (t * f * Math.pow(2, det / 12)) % 1;
        const saw = 2 * ph - 1;
        pl += saw * (det < 0 ? 0.6 : 0.4);
        pr += saw * (det < 0 ? 0.4 : 0.6);
      }
    }
    const swell = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, inBar * 1.2));
    const cutoff = 700 + 900 * swell + 500 * Math.sin(t * 0.21);
    let padL = lpL(pl * 0.05, cutoff, 0.9).low;
    let padR = lpR(pr * 0.05, cutoff, 0.9).low;
    // sub bass
    const bf = midi(bassNotes[barIdx % 4]);
    const beatPos = (t % beat) / beat;
    const bassEnv = Math.min(1, beatPos * 20) * Math.exp(-beatPos * 1.2);
    const bass = Math.sin(2 * Math.PI * bf * t) * 0.22 * bassEnv * (barIdx >= 2 ? 1 : 0);
    // kick on every beat from bar 2, with side-chain ducking of the pad
    let kick = 0;
    let duck = 1;
    if (barIdx >= 2 && barIdx < bars - 1) {
      const kt = t % beat;
      const kf = 48 + 90 * Math.exp(-kt * 30);
      kick = Math.sin(2 * Math.PI * kf * kt) * Math.exp(-kt * 9) * 0.55;
      duck = 0.55 + 0.45 * Math.min(1, kt / (beat * 0.6));
    }
    // light hats on off-beats from bar 4
    let hat = 0;
    if (barIdx >= 4 && barIdx < bars - 1) {
      const ht = (t + beat / 2) % beat;
      hat = rand() * Math.exp(-ht * 70) * 0.06;
    }
    // sparkle arpeggio (high bell) from bar 6
    let bell = 0;
    if (barIdx >= 6 && barIdx < bars - 1) {
      const step = beat / 2;
      const k = Math.floor(t / step);
      const bt = t % step;
      const m = chord[k % chord.length] + 24;
      bell = Math.sin(2 * Math.PI * midi(m) * t) * Math.exp(-bt * 7) * 0.05;
    }
    const master = Math.min(1, t / 3) * Math.min(1, (len - t) / 3.5);
    L[i] = (padL * duck + bass + kick + hat * 0.8 + bell * 0.7) * master;
    R[i] = (padR * duck + bass + kick + hat * 1.2 + bell * 1.1) * master;
  }
  const [sl, sr] = space(L, R, { time: beat * 0.75, fb: 0.3, mix: 0.22 });
  writeWav('music.wav', sl, sr);
}

/* ------------------------------------------------------------------ */
/* SFX                                                                 */
/* ------------------------------------------------------------------ */

// Whoosh: filtered noise with a band-pass sweep and swell.
function whoosh(name, dur, from, to, gain = 0.9) {
  const L = arr(dur), R = arr(dur);
  const fl = svf(), fr = svf();
  for (let i = 0; i < L.length; i++) {
    const p = i / L.length;
    const env = Math.sin(Math.PI * Math.pow(p, 0.7)) ** 2;
    const c = from * Math.pow(to / from, p);
    L[i] = fl(rand(), c, 0.35).band * env * gain;
    R[i] = fr(rand(), c * 1.05, 0.35).band * env * gain;
  }
  writeWav(name, ...space(L, R, { time: 0.09, fb: 0.2, mix: 0.2 }));
}
whoosh('whoosh.wav', 0.7, 400, 4200);
whoosh('whoosh-soft.wav', 0.55, 600, 2600, 0.6);

// UI click: tiny filtered transient.
{
  const L = arr(0.06);
  const f = svf();
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    L[i] = f(rand(), 3500, 0.5).band * Math.exp(-t * 180) * 1.2 + Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 260) * 0.4;
  }
  writeWav('click.wav', L);
}

// Pop: sine blip with a quick downward pitch bend.
{
  const L = arr(0.18);
  let ph = 0;
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    const f = 520 + 600 * Math.exp(-t * 40);
    ph += (2 * Math.PI * f) / SR;
    L[i] = Math.sin(ph) * Math.exp(-t * 22) * 0.8;
  }
  writeWav('pop.wav', L);
}

// Tick (typing / counter).
{
  const L = arr(0.04);
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    L[i] = Math.sin(2 * Math.PI * 3200 * t) * Math.exp(-t * 400) * 0.5;
  }
  writeWav('tick.wav', L);
}

// Chime: two-note bell (focus complete / success).
{
  const L = arr(1.8), R = arr(1.8);
  const notes = [
    [midi(84), 0],
    [midi(91), 0.14],
  ];
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    let s = 0;
    for (const [f, start] of notes) {
      if (t < start) continue;
      const tt = t - start;
      s += (Math.sin(2 * Math.PI * f * tt) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * tt) * Math.exp(-tt * 6)) * Math.exp(-tt * 2.6);
    }
    L[i] = s * 0.35;
    R[i] = s * 0.35;
  }
  writeWav('chime.wav', ...space(L, R, { time: 0.18, fb: 0.35, mix: 0.3 }));
}

// Riser: noise + rising tone into the logo hit.
{
  const dur = 1.6;
  const L = arr(dur), R = arr(dur);
  const fl = svf(), fr = svf();
  let ph = 0;
  for (let i = 0; i < L.length; i++) {
    const p = i / L.length;
    const t = i / SR;
    const f = 180 * Math.pow(10, p * 1.1);
    ph += (2 * Math.PI * f) / SR;
    const env = Math.pow(p, 2.2);
    const c = 300 * Math.pow(30, p);
    L[i] = (fl(rand(), c, 0.4).band * 0.8 + Math.sin(ph) * 0.15) * env;
    R[i] = (fr(rand(), c * 1.1, 0.4).band * 0.8 + Math.sin(ph * 1.003) * 0.15) * env;
    void t;
  }
  writeWav('riser.wav', L, R);
}

// Impact: low boom + bright noise burst + tail.
{
  const dur = 2.2;
  const L = arr(dur), R = arr(dur);
  const f = svf();
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    const boomF = 40 + 70 * Math.exp(-t * 12);
    const boom = Math.sin(2 * Math.PI * boomF * t) * Math.exp(-t * 3.2) * 0.9;
    const burst = f(rand(), 2500, 0.6).band * Math.exp(-t * 14) * 0.5;
    L[i] = boom + burst;
    R[i] = boom + burst * 0.9;
  }
  writeWav('impact.wav', ...space(L, R, { time: 0.31, fb: 0.4, mix: 0.3 }));
}

// Shimmer: airy sparkle for the logo star.
{
  const L = arr(1.2), R = arr(1.2);
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    let s = 0;
    for (const m of [96, 100, 103, 107]) s += Math.sin(2 * Math.PI * midi(m) * t + m) * Math.exp(-t * (3 + (m - 96) * 0.3));
    L[i] = s * 0.09 * Math.min(1, t * 40);
    R[i] = s * 0.09 * Math.min(1, t * 40);
  }
  writeWav('shimmer.wav', ...space(L, R, { time: 0.13, fb: 0.45, mix: 0.35 }));
}
