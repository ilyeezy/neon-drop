import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, deserializeGame, SAVE_VERSION } from '../src/core/game.js';
import { baseGame, randomProvider, firstFit, comparable, scripted, trioP1 } from './_helpers.js';

const rndCfg = (over = {}) => ({
  size: 8, seed: 20260824, headless: true, trayProvider: randomProvider, ...over,
});

// @spec CORE-DET-001
test('ядро само не расходует PRNG: без запросов к провайдеру состояние неподвижно', () => {
  const g = baseGame(); // скриптованный провайдер PRNG не трогает
  const state0 = g.serialize().rngState;
  g.placePiece(0, 0, 0);
  g.applyBooster('hammer', { x: 0, y: 0 });
  g.undo();
  g.placePiece(1, 2, 2);
  assert.equal(g.serialize().rngState, state0);
});

// @spec CORE-DET-002
test('undo → повтор того же хода → идентичная тройка, включая цвета', () => {
  const g = createGame({ ...rndCfg(), boosters: { hammer: 0, shuffle: 0, undo: 9 } });
  firstFit(g);
  firstFit(g);
  const before = JSON.stringify(comparable(g.serialize()));
  const move = firstFit(g); // третья постановка опустошает трей → рефилл тратит PRNG
  const trayAfter = JSON.stringify(g.trayView());
  const rngAfter = g.serialize().rngState;
  assert.equal(g.undo().ok, true);
  assert.equal(JSON.stringify(comparable(g.serialize())), before);
  g.placePiece(move.slot, move.x, move.y);
  assert.equal(JSON.stringify(g.trayView()), trayAfter);
  assert.equal(g.serialize().rngState, rngAfter);
});

// @spec CORE-DET-003
test('восстановленная партия продолжается идентично непрерывной', () => {
  const g1 = createGame(rndCfg());
  for (let i = 0; i < 10; i++) firstFit(g1);
  const saved = g1.serialize();
  const g2 = deserializeGame(JSON.parse(JSON.stringify(saved)), rndCfg());
  for (let i = 0; i < 10; i++) {
    firstFit(g1);
    firstFit(g2);
  }
  assert.equal(JSON.stringify(g1.serialize()), JSON.stringify(g2.serialize()));
});

// @spec CORE-DET-004
test('один сид + одни команды = одно состояние', () => {
  const a = createGame(rndCfg());
  const b = createGame(rndCfg());
  for (let i = 0; i < 30; i++) {
    const ma = firstFit(a);
    const mb = firstFit(b);
    if (!ma || !mb) break;
  }
  assert.equal(JSON.stringify(a.serialize()), JSON.stringify(b.serialize()));
});

// @spec CORE-SER-001
test('serialize: версия и полное состояние партии', () => {
  const g = baseGame();
  g.placePiece(0, 0, 0);
  const s = g.serialize();
  assert.equal(s.version, SAVE_VERSION);
  for (const key of ['size', 'phase', 'masks', 'colors', 'specials', 'specialData',
    'goldMask', 'tray', 'score', 'streakStep', 'moveCount', 'lastIssued', 'rngState', 'boosters']) {
    assert.ok(key in s, key);
  }
  assert.ok(!('undoStack' in s)); // кольцо undo в сейв не входит — объём автосейва
});

// @spec CORE-SER-002
test('байтовый round-trip сериализации', () => {
  const g = createGame(rndCfg());
  for (let i = 0; i < 7; i++) firstFit(g);
  const s1 = JSON.stringify(g.serialize());
  const restored = deserializeGame(JSON.parse(s1), rndCfg());
  assert.equal(JSON.stringify(restored.serialize()), s1);
  assert.equal(restored.undoRing.length, 0); // после загрузки кольцо пусто
});

// @spec CORE-SER-003
test('несовпадение версии сейва — ошибка, а не попытка угадать', () => {
  const cfg = { size: 8, seed: 42, headless: true, trayProvider: scripted(trioP1()) };
  const s = createGame(cfg).serialize();
  assert.throws(() => deserializeGame({ ...s, version: SAVE_VERSION + 1 }, cfg));
  assert.throws(() => deserializeGame({ ...s, version: undefined }, cfg));
});
