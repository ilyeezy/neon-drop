// Только WebAudio: ни одного медиа-тега, mediaSession не трогается (п. 1.6.1.6).
// AudioContext создаётся лениво, resume() — на первом жесте пользователя.
let ctx = null;
let master = null;
let sfxGain = null;
let musicGain = null;
let soundOn = true;
let musicOn = true;
let musicTimer = null;
let unlocked = false;
let musicNodes = [];      // звучащие сейчас ноты музыки
const MUSIC_VOL = 0.16;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  sfxGain = ctx.createGain();
  sfxGain.connect(master);
  musicGain = ctx.createGain();
  musicGain.gain.value = MUSIC_VOL;
  musicGain.connect(master);
  return ctx;
}

export function initAudio(settings) {
  soundOn = settings.sound;
  musicOn = settings.music;
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    ensureCtx();
    ctx?.resume?.();
    if (musicOn) startMusic();
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

export function setSound(on) { soundOn = on; }
export function setMusic(on) {
  musicOn = on;
  if (on && unlocked) startMusic();
  if (!on) stopMusic();
}

// Потеря фокуса / реклама: полная тишина через suspend (п. 1.3, 4.7).
export function suspendAudio() { ctx?.suspend?.(); }
export function resumeAudio() { if (unlocked) ctx?.resume?.(); }

function tone({ freq = 440, dur = 0.12, type = 'sine', vol = 0.25, slide = 0, delay = 0 }) {
  if (!soundOn || !ensureCtx() || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g);
  g.connect(sfxGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.12, vol = 0.15, delay = 0 }) {
  if (!soundOn || !ensureCtx() || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(g);
  g.connect(sfxGain);
  src.start(t0);
}

export const sfx = {
  uiClick: () => tone({ freq: 660, dur: 0.05, type: 'triangle', vol: 0.12 }),
  pick: () => tone({ freq: 520, dur: 0.07, type: 'triangle', vol: 0.15, slide: 120 }),
  place: () => { tone({ freq: 220, dur: 0.08, type: 'square', vol: 0.1 }); noise({ dur: 0.06, vol: 0.08 }); },
  invalid: () => tone({ freq: 140, dur: 0.12, type: 'square', vol: 0.12, slide: -40 }),
  clear: (n) => {
    for (let i = 0; i < Math.min(n, 4); i++) {
      tone({ freq: 440 + i * 120, dur: 0.16, type: 'sawtooth', vol: 0.14, slide: 200, delay: i * 0.05 });
    }
    noise({ dur: 0.18, vol: n >= 2 ? 0.16 : 0.1 });
  },
  // тон растёт со ступенью стрика — дешёвый и очень приятный приём (ТЗ п. 9)
  streak: (step) => tone({ freq: 500 * Math.pow(1.19, Math.min(step, 6)), dur: 0.2, type: 'triangle', vol: 0.2, slide: 180 }),
  booster: () => tone({ freq: 380, dur: 0.14, type: 'sawtooth', vol: 0.15, slide: 240 }),
  iceCrack: () => { noise({ dur: 0.09, vol: 0.14 }); tone({ freq: 900, dur: 0.06, type: 'triangle', vol: 0.1 }); },
  bombTick: () => tone({ freq: 1100, dur: 0.05, type: 'square', vol: 0.1 }),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.22, type: 'triangle', vol: 0.18, delay: i * 0.1 })),
  lose: () => [330, 277, 220, 165].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'sine', vol: 0.16, delay: i * 0.14 })),
  perfect: () => [784, 988, 1175, 1568].forEach((f, i) => tone({ freq: f, dur: 0.25, type: 'triangle', vol: 0.16, delay: i * 0.07 })),
};

// Музыка: ненавязчивый минорный луп — пад из двух детюненных осцилляторов
// и редкий арпеджио по пентатонике, планирование тактами.
const PAD = [110, 130.8, 98, 87.3]; // Am – C – G – F в басу
const PLUCK = [220, 261.6, 329.6, 392, 440];

function trackMusicNode(node) {
  musicNodes.push(node);
  node.onended = () => { musicNodes = musicNodes.filter((n) => n !== node); };
}

function scheduleBar(barIdx) {
  if (!musicOn || !ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + 0.05;
  const root = PAD[barIdx % PAD.length];
  for (const det of [-2, 2]) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = root;
    osc.detune.value = det * 4;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.6);
    g.gain.linearRampToValueAtTime(0.0, t0 + 3.6);
    osc.connect(f);
    f.connect(g);
    g.connect(musicGain);
    trackMusicNode(osc);
    osc.start(t0);
    osc.stop(t0 + 3.8);
  }
  for (let i = 0; i < 4; i++) {
    if ((barIdx + i) % 3 === 0) continue; // разреженность
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = PLUCK[(barIdx * 2 + i * 3) % PLUCK.length];
    const ts = t0 + 0.4 + i * 0.8;
    g.gain.setValueAtTime(0, ts);
    g.gain.linearRampToValueAtTime(0.06, ts + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ts + 0.7);
    osc.connect(g);
    g.connect(musicGain);
    trackMusicNode(osc);
    osc.start(ts);
    osc.stop(ts + 0.8);
  }
}

let bar = 0;
function startMusic() {
  if (musicTimer || !ensureCtx()) return;
  const now = ctx.currentTime;
  musicGain.gain.cancelScheduledValues(now);
  musicGain.gain.setValueAtTime(MUSIC_VOL, now);
  const loop = () => {
    scheduleBar(bar);
    bar += 1;
    musicTimer = setTimeout(loop, 3600);
  };
  loop();
}

function stopMusic() {
  if (musicTimer) {
    clearTimeout(musicTimer);
    musicTimer = null;
  }
  if (!ctx || !musicGain) return;
  // отменяем таймер мало: уже запущенные ноты тянутся до 3.8 с. Сводим шину
  // музыки к нулю коротким рампом (чтобы не щёлкнуло) и обрываем сами ноты.
  const now = ctx.currentTime;
  musicGain.gain.cancelScheduledValues(now);
  musicGain.gain.setValueAtTime(musicGain.gain.value, now);
  musicGain.gain.linearRampToValueAtTime(0, now + 0.06);
  for (const node of musicNodes) {
    try { node.stop(now + 0.08); } catch { /* уже остановлена */ }
  }
  musicNodes = [];
}
