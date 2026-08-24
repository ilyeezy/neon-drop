import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/core/game.js';
import { baseGame, noFitGame, capture, p } from './_helpers.js';

// @spec CORE-FSM-001
test('переходы вне схемы FSM отвергаются', () => {
  const g = baseGame();
  assert.equal(g.phase, 'playing');
  assert.equal(g.animationsDone().ok, false);
  assert.equal(g.resume().ok, false);
  assert.equal(g.reset().ok, false);
  assert.equal(g.pause().ok, true);
  assert.equal(g.pause().ok, false);
  g.resume();
  g.end('loss', 'quit');
  assert.equal(g.pause().ok, false);
  assert.equal(g.reset().ok, true);
  assert.equal(g.phase, 'idle');
});

// @spec CORE-FSM-002
test('ход уводит в animating, обратно — только animationsDone', () => {
  const g = baseGame({ headless: false });
  g.placePiece(0, 0, 0);
  assert.equal(g.phase, 'animating');
  assert.equal(g.animationsDone().ok, true);
  assert.equal(g.phase, 'playing');
});

// @spec CORE-FSM-003
test('в animating ввод отбрасывается и не буферизуется', () => {
  const g = baseGame({ headless: false, initialBoard: [{ x: 5, y: 5, color: 1 }] });
  g.placePiece(0, 0, 0);
  const log = capture(g, ['piecePlaced', 'boosterApplied', 'undoApplied']);
  assert.equal(g.placePiece(1, 2, 2).ok, false);
  assert.equal(g.applyBooster('hammer', { x: 5, y: 5 }).ok, false);
  assert.equal(g.undo().ok, false);
  g.animationsDone();
  assert.equal(log.length, 0); // отложенных действий не появилось
  assert.equal(g.moveCount, 1);
});

// @spec CORE-FSM-004
test('headless: animating пропускается', () => {
  const g = baseGame({ headless: true });
  g.placePiece(0, 0, 0);
  assert.equal(g.phase, 'playing');
});

// @spec CORE-FSM-005
test('ход, завершивший партию, минует animating', () => {
  const g = noFitGame({ headless: false });
  g.placePiece(0, 3, 3);
  assert.equal(g.phase, 'over');
});

// @spec CORE-FSM-006
test('пауза из animating домалывает анимации: после resume игра принимает ввод', () => {
  const g = baseGame({ headless: false });
  g.pause();
  g.resume();
  assert.equal(g.phase, 'playing');
  g.placePiece(0, 0, 0);
  assert.equal(g.phase, 'animating');
  g.pause(); // платформенная пауза при показе рекламы: rAF стоит, очередь оборвана
  assert.equal(g.phase, 'paused');
  assert.equal(g.placePiece(1, 3, 3).ok, false); // в паузе ввод закрыт
  g.resume();
  assert.equal(g.phase, 'playing'); // не animating: animationsDone слать некому
  assert.equal(g.placePiece(1, 3, 3).ok, true); // игра живая, дедлока нет
});

// @spec CORE-FSM-007
test('end вне конвейера завершает партию немедленно', () => {
  const g = baseGame();
  const log = capture(g, ['gameOver']);
  assert.equal(g.end('loss', 'bomb').ok, true);
  assert.equal(g.phase, 'over');
  assert.deepEqual(log[0].payload, { outcome: 'loss', reason: 'bomb' });
  assert.equal(g.end('win', 'goal').ok, false); // партия уже завершена
});

// @spec CORE-FSM-008
test('over терминален: постановка и бустеры отвергаются', () => {
  const g = noFitGame();
  g.placePiece(0, 3, 3);
  assert.equal(g.phase, 'over');
  assert.equal(g.placePiece(2, 0, 0).ok, false);
  assert.equal(g.applyBooster('hammer', { x: 1, y: 0 }).ok, false);
  assert.equal(g.applyBooster('shuffle').ok, false);
  assert.equal(g.undo().ok, false);
});

// @spec CORE-FSM-010
test('старт валидирует конфигурацию до каких-либо событий', () => {
  assert.throws(() => createGame({ size: 8 })); // нет провайдера
  assert.throws(() => createGame({ size: 8, trayProvider: () => [p('P1')] })); // не то число фигур
  assert.throws(() => createGame({
    size: 8, trayProvider: () => [p('COMET'), p('P1'), p('P1')],
  })); // неизвестная фигура
  const g = baseGame();
  assert.equal(g.phase, 'playing');
  assert.equal(g.tray.filter(Boolean).length, 3);
  assert.deepEqual(g.placeable, [true, true, true]);
});

// @spec CORE-FSM-009
test('одновременные победа и поражение: побеждает победа', () => {
  const g = noFitGame();
  g.on('moveResolved', () => g.end('win', 'goal'));
  const log = capture(g, ['gameOver']);
  g.placePiece(0, 3, 3); // ход одновременно выполняет цель и забивает поле
  assert.deepEqual(g.result, { outcome: 'win', reason: 'goal' });
  assert.deepEqual(log[0].payload, { outcome: 'win', reason: 'goal' });
  assert.equal(log.length, 1);
});
