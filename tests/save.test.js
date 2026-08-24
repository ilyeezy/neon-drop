import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSave, migrate, parseSave, pickFresher, createSaveManager, SAVE_SCHEMA_VERSION,
} from '../src/save/storage.js';
import { createGame } from '../src/core/game.js';
import { scripted, trioP1 } from './_helpers.js';

const memMirror = () => {
  let stored = null;
  return { load: () => stored, save: (s) => { stored = s; return true; }, get raw() { return stored; } };
};

const okPlatform = () => {
  const calls = [];
  return {
    calls,
    async loadRaw() { return null; },
    async saveRaw(str, flush) { calls.push({ str, flush }); return true; },
  };
};

// @spec SAVE-SCH-001
test('дефолтный сейв: все разделы схемы v1', () => {
  const s = defaultSave(123);
  assert.equal(s.version, SAVE_SCHEMA_VERSION);
  assert.equal(s.timestamp, 123);
  for (const key of ['settings', 'records', 'daily', 'progress', 'stats', 'boosters']) {
    assert.ok(key in s, key);
  }
  assert.equal(s.currentRun, null);
  assert.deepEqual(s.boosters, { hammer: 3, shuffle: 3, undo: 3 });
});

// @spec SAVE-SCH-002
test('двойное чтение: побеждает свежий, мусор игнорируется, дефолт при пустоте', async () => {
  const older = { ...defaultSave(100), records: { classic: 111, big: 0, fairClassic: 0, fairBig: 0 } };
  const newer = { ...defaultSave(200), records: { classic: 222, big: 0, fairClassic: 0, fairBig: 0 } };
  assert.equal(pickFresher(older, newer).records.classic, 222);
  assert.equal(pickFresher(newer, older).records.classic, 222);
  assert.equal(parseSave('{broken'), null);
  assert.equal(parseSave(JSON.stringify({ hello: 1 })), null);

  const platform = { async loadRaw() { return JSON.stringify(older); }, async saveRaw() { return true; } };
  const mirror = { load: () => '{broken json', save: () => true };
  const mgr = createSaveManager({ platform, mirror });
  const data = await mgr.load();
  assert.equal(data.records.classic, 111); // битое зеркало проигнорировано

  const empty = createSaveManager({
    platform: { async loadRaw() { return null; }, async saveRaw() { return true; } },
    mirror: { load: () => null, save: () => true },
  });
  assert.equal((await empty.load()).version, SAVE_SCHEMA_VERSION);
});

// @spec SAVE-SCH-003
test('миграции: будущая версия и неизвестная старая — дефолт', () => {
  const future = { ...defaultSave(100), version: SAVE_SCHEMA_VERSION + 1, records: { classic: 999 } };
  assert.equal(migrate(future, 5).records.classic, 0);
  const ancient = { version: 0, timestamp: 1 };
  assert.equal(migrate(ancient, 5).version, SAVE_SCHEMA_VERSION);
  const current = defaultSave(7);
  assert.equal(migrate(current, 5), current);
});

// @spec SAVE-SCH-004
test('двойная запись: отказ SDK не отменяет локальную', async () => {
  const mirror = memMirror();
  const platform = { async loadRaw() { return null; }, async saveRaw() { throw new Error('offline'); } };
  const mgr = createSaveManager({ platform, mirror, now: () => 42 });
  await mgr.load();
  mgr.data.records.classic = 500;
  mgr.commit(true);
  assert.equal(JSON.parse(mirror.raw).records.classic, 500);
});

// @spec SAVE-SCH-005
test('дебаунс 2 с для некритичных, критичные — сразу', async () => {
  const mirror = memMirror();
  const platform = okPlatform();
  const timers = [];
  const mgr = createSaveManager({
    platform,
    mirror,
    now: () => 1,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: (id) => { timers[id - 1].cleared = true; },
  });
  await mgr.load();
  mgr.data.settings.sound = false;
  mgr.commit(false);
  mgr.commit(false); // второй сбрасывает первый таймер
  assert.equal(mirror.raw, null); // ничего не записано до таймера
  assert.equal(timers.length, 2);
  assert.equal(timers[0].cleared, true);
  assert.equal(timers[1].ms, 2000);
  timers[1].fn();
  assert.equal(JSON.parse(mirror.raw).settings.sound, false);
  mgr.data.records.classic = 900;
  mgr.commit(true); // критичная — немедленно
  assert.equal(JSON.parse(mirror.raw).records.classic, 900);
  assert.equal(platform.calls.at(-1).flush, true);
});

// @spec SAVE-RUN-001
test('автосейв партии: currentRun с serialize() ядра, завершение чистит', async () => {
  const mirror = memMirror();
  const mgr = createSaveManager({ platform: okPlatform(), mirror });
  await mgr.load();
  const game = createGame({ size: 8, seed: 5, headless: true, trayProvider: scripted(trioP1()) });
  game.placePiece(0, 0, 0);
  mgr.data.currentRun = { modeId: 'classic', levelId: null, extra: {}, core: game.serialize() };
  mgr.commit(true);
  const stored = JSON.parse(mirror.raw);
  assert.equal(stored.currentRun.modeId, 'classic');
  assert.equal(stored.currentRun.core.moveCount, 1);
  mgr.data.currentRun = null;
  mgr.data.records.classic = game.score;
  mgr.commit(true);
  const finished = JSON.parse(mirror.raw);
  assert.equal(finished.currentRun, null);
  assert.equal(finished.records.classic, game.score);
});
