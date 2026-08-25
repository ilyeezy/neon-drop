import { test } from 'node:test';
import assert from 'node:assert/strict';

// Мок WebAudio: заодно фиксирует, что звук не трогает медиа-элементы и
// mediaSession — системный плеер на мобильных это причина отказа модерации.
const created = { oscillators: [], gains: [] };
function makeParam(initial = 0) {
  return {
    value: initial,
    calls: [],
    setValueAtTime(v) { this.value = v; this.calls.push(['set', v]); },
    linearRampToValueAtTime(v, t) { this.calls.push(['ramp', v, t]); this.value = v; },
    exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); },
    cancelScheduledValues() { this.calls.push(['cancel']); },
  };
}
class MockCtx {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.sampleRate = 48000;
    this.destination = { connect() {} };
  }
  createGain() {
    const g = { gain: makeParam(1), connect() {} };
    created.gains.push(g);
    return g;
  }
  createOscillator() {
    const o = {
      type: 'sine', frequency: makeParam(440), detune: makeParam(0),
      connect() {}, started: null, stopped: null, onended: null,
      start(t) { this.started = t; }, stop(t) { this.stopped = t; },
    };
    created.oscillators.push(o);
    return o;
  }
  createBiquadFilter() { return { type: 'lowpass', frequency: makeParam(400), connect() {} }; }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { return { buffer: null, connect() {}, start() {} }; }
  resume() {}
  suspend() { this.state = 'suspended'; }
}

const handlers = {};
globalThis.window = { addEventListener: (type, fn) => { handlers[type] = fn; } };
globalThis.AudioContext = MockCtx;

const { initAudio, setMusic } = await import('../src/audio/sound.js');

test('музыка выключается немедленно, а не доигрывает такт', () => {
  initAudio({ sound: true, music: true });
  handlers.pointerdown(); // разблокировка звука первым жестом
  const playing = created.oscillators.filter((o) => o.started !== null);
  assert.ok(playing.length > 0, 'музыка зазвучала');
  const musicBus = created.gains.find((g) => g.gain.value === 0.16);
  assert.ok(musicBus, 'шина музыки создана');

  setMusic(false);
  // шина музыки сведена в ноль коротким рампом — слышно сразу
  const ramp = musicBus.gain.calls.find((c) => c[0] === 'ramp' && c[1] === 0);
  assert.ok(ramp, 'громкость музыки сведена к нулю');
  assert.ok(ramp[2] <= 0.1, `рамп должен быть коротким, а не ${ramp[2]} с`);
  // и сами ноты оборваны, а не доигрывают свои 3.8 с
  for (const osc of playing) {
    assert.ok(osc.stopped <= 0.1, `нота обрывается сразу, а не в ${osc.stopped}`);
  }
});

test('повторное включение возвращает громкость музыки', () => {
  const before = created.oscillators.length;
  setMusic(true);
  const musicBus = created.gains.find((g) => g.gain.calls.some((c) => c[0] === 'set' && c[1] === 0.16));
  assert.ok(musicBus, 'громкость восстановлена');
  assert.ok(created.oscillators.length > before, 'ноты планируются заново');
  setMusic(false); // иначе цикл планирования тактов не даст процессу завершиться
});
