// Tiny WebAudio synth: every sound is generated, so there are no audio files to load or block.
let ctx = null, master = null, noiseBuf = null, muted = false;
try { muted = localStorage.getItem('arcade.muted') === '1'; } catch {}

export function unlockAudio() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.55; master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch { ctx = null; }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
export const isMuted = () => muted;
export function setMuted(m) {
  muted = m; try { localStorage.setItem('arcade.muted', m ? '1' : '0'); } catch {}
  if (master) master.gain.value = m ? 0 : 0.55;
}

function tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, type = 'lowpass', freq = 1000, q = 0.8, delay = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

export const sfx = {
  dribble(v = 1) { tone(105, 0.09, 'sine', 0.45 * v, 48); noise(0.035, 0.08 * v, 'lowpass', 900); },
  bounce(v = 1) { tone(95, 0.1, 'sine', 0.35 * v, 45); },
  swish() { noise(0.32, 0.22, 'bandpass', 3400, 0.6); noise(0.2, 0.08, 'highpass', 6000, 0.5, 0.05); },
  clank() { tone(540, 0.28, 'square', 0.06); tone(812, 0.32, 'square', 0.045); tone(1250, 0.2, 'triangle', 0.05); noise(0.05, 0.12, 'highpass', 2500); },
  board() { tone(150, 0.12, 'triangle', 0.25, 90); noise(0.06, 0.12, 'lowpass', 700); },
  green() { tone(880, 0.12, 'sine', 0.16); tone(1318, 0.3, 'sine', 0.13, null, 0.07); },
  cross() { tone(2600, 0.07, 'sine', 0.04, 3600); noise(0.1, 0.08, 'bandpass', 1400, 2); },
  ankle() { tone(3000, 0.12, 'sine', 0.06, 1800); tone(70, 0.4, 'sine', 0.4, 35, 0.04); noise(0.3, 0.15, 'lowpass', 500, 0.7, 0.04); },
  swipe() { noise(0.12, 0.08, 'highpass', 1800); },
  steal() { tone(320, 0.14, 'sawtooth', 0.07, 160); noise(0.08, 0.12, 'bandpass', 900); },
  block() { tone(85, 0.25, 'sine', 0.5, 40); noise(0.12, 0.2, 'lowpass', 500); },
  jump() { tone(2200, 0.05, 'sine', 0.025, 2800); },
  deny() { tone(170, 0.12, 'square', 0.06, 140); },
  catch() { noise(0.04, 0.1, 'lowpass', 1200); },
  dunk() { tone(60, 0.5, 'sine', 0.6, 30); noise(0.5, 0.25, 'lowpass', 800); tone(540, 0.35, 'square', 0.05); },
  crowd(v = 1) { noise(1.1, 0.07 * v, 'bandpass', 900, 0.4); noise(0.9, 0.05 * v, 'bandpass', 1900, 0.6, 0.08); },
  buzzer() { tone(196, 0.9, 'sawtooth', 0.08); tone(201, 0.9, 'sawtooth', 0.08); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, 'triangle', 0.12, null, i * 0.11)); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.4, 'triangle', 0.1, null, i * 0.16)); },
  click() { tone(700, 0.04, 'square', 0.04); },
  fire() { noise(0.6, 0.2, 'bandpass', 700, 0.5); tone(220, 0.6, 'sawtooth', 0.06, 880); },
  takeover() { [392, 494, 587, 784].forEach((f, i) => tone(f, 0.7, 'triangle', 0.1, null, i * 0.06)); noise(0.8, 0.15, 'bandpass', 1200, 0.4); },
};

// ---------- beat: a simple scheduled loop that layers up with the game ----------
let beatTimer = null, step = 0, next = 0, level = 0;
const KICK = [0, 6, 10, 16, 22, 26], SNARE = [8, 24], BASS = [55, 55, 65.4, 49];
export function setBeat(l) { level = l; }
export function stopBeat() { clearInterval(beatTimer); beatTimer = null; }
export function startBeat() {
  if (!ctx || beatTimer) return;
  const s16 = 60 / 96 / 4; step = 0; next = ctx.currentTime + 0.1;
  beatTimer = setInterval(() => {
    if (!ctx) return;
    if (muted) { next = ctx.currentTime + 0.1; return; }
    while (next < ctx.currentTime + 0.2) {
      const d = next - ctx.currentTime;
      if (KICK.includes(step)) { tone(70, 0.22, 'sine', 0.28, 38, d); if (level >= 1) tone(BASS[Math.floor(step / 8)], 0.3, 'triangle', 0.07, null, d); }
      if (SNARE.includes(step)) { noise(0.16, 0.09, 'bandpass', 1800, 0.7, d); if (level >= 2) noise(0.1, 0.06, 'highpass', 4000, 0.7, d + 0.01); }
      if (step % (level >= 2 ? 1 : 2) === 0) noise(0.03, level >= 1 ? 0.03 : 0.018, 'highpass', 8000, 0.7, d);
      if (level >= 3 && step % 4 === 2) tone(880, 0.08, 'square', 0.025, null, d);
      next += s16; step = (step + 1) % 32;
    }
  }, 50);
}
