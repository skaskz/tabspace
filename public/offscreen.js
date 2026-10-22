// Tabspace offscreen document: synthesises an original, soft two-note chime
// with WebAudio oscillators (no audio files). Only messages explicitly
// addressed to the offscreen document, from this extension, are handled.
/* global chrome, AudioContext */
'use strict';

let ctx = null;

function chime() {
  ctx = ctx || new AudioContext();
  const start = ctx.currentTime + 0.05;
  const master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
  // E5 then A5, each a sine with a gentle octave overtone and an exponential decay.
  [
    { f: 659.25, t: 0 },
    { f: 880.0, t: 0.28 },
  ].forEach(({ f, t }) => {
    [
      { mul: 1, gain: 1 },
      { mul: 2, gain: 0.18 },
    ].forEach(({ mul, gain }) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f * mul;
      env.gain.setValueAtTime(0.0001, start + t);
      env.gain.exponentialRampToValueAtTime(gain, start + t + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, start + t + 1.4);
      osc.connect(env).connect(master);
      osc.start(start + t);
      osc.stop(start + t + 1.5);
    });
  });
  return ctx.resume().then(() => ctx.state);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || msg.target !== 'offscreen' || msg.type !== 'chime') return;
  try {
    chime().then(
      (state) => sendResponse({ ok: true, state }),
      (e) => sendResponse({ ok: false, error: String(e) }),
    );
  } catch (e) {
    sendResponse({ ok: false, error: String(e) });
  }
  return true;
});
