import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseGame, noFitGame, scripted, p, trioP1, rowCells, range, capture } from './_helpers.js';
import { createGame } from '../src/core/game.js';
import { isOccupied } from '../src/core/bitboard.js';

// @spec CORE-MOVE-001
test('невалидная постановка отвергается без следов', () => {
  const g = baseGame({
    initialBoard: [{ x: 0, y: 7, color: 1, special: 'bomb', timer: 5 }],
  });
  g.placePiece(0, 0, 0);
  const before = JSON.stringify(g.serialize());
  assert.deepEqual(g.placePiece(1, 0, 0), { ok: false, reason: 'invalid' }); // занято
  assert.equal(g.placePiece(1, 7, 9).ok, false); // за границей
  assert.equal(g.placePiece(1, -1, 0).ok, false);
  assert.equal(JSON.stringify(g.serialize()), before); // ни очков, ни тиков, ни снапшотов
});

// @spec CORE-MOVE-002
test('валидная постановка пишет клетки цветом и даёт +1 за клетку', () => {
  const g = baseGame({ trayProvider: scripted([p('T4_0', 3), p('P1'), p('P1')]) });
  const log = capture(g, ['piecePlaced']);
  const res = g.placePiece(0, 0, 0);
  assert.equal(res.ok, true);
  assert.equal(res.scoreDelta, 4);
  assert.deepEqual(log[0].payload.cells, [[0, 0], [1, 0], [2, 0], [1, 1]]);
  for (const [x, y] of log[0].payload.cells) {
    assert.equal(isOccupied(g.board, x, y), true);
    assert.equal(g.board.colors[y * 8 + x], 3);
  }
});

// @spec CORE-MOVE-003
test('одновременная очистка строки и столбца: пересечение один раз', () => {
  const g = baseGame({
    initialBoard: [
      ...rowCells(3, range(0, 6)),                    // строка 3 без (7,3)
      ...[0, 1, 2, 4, 5, 6, 7].map((y) => ({ x: 7, y, color: 1 })), // столбец 7 без (7,3)
    ],
  });
  const log = capture(g, ['linesCleared', 'boardEmpty']);
  const res = g.placePiece(0, 7, 3);
  assert.equal(res.cleared, 2);
  const cleared = log.find((e) => e.n === 'linesCleared').payload;
  assert.deepEqual(cleared.rows, [3]);
  assert.deepEqual(cleared.cols, [7]);
  assert.equal(cleared.removedCells.length, 15); // 8 + 8 − 1 пересечение
  assert.ok(log.some((e) => e.n === 'boardEmpty')); // на поле ничего не осталось
});

// @spec CORE-MOVE-005
test('пустой трей пополняется через провайдер с полем и PRNG партии', () => {
  let calls = 0;
  let gotBoard = null;
  let gotRng = null;
  let gotCount = null;
  const seenPrevious = [];
  const provider = (board, rng, opts) => {
    calls += 1;
    gotBoard = board;
    gotRng = rng;
    gotCount = opts.count;
    seenPrevious.push(opts.previous ?? null);
    return trioP1().slice(0, opts.count);
  };
  const g = createGame({ size: 8, seed: 1, headless: true, trayProvider: provider });
  assert.equal(calls, 1);
  g.placePiece(0, 0, 0);
  g.placePiece(1, 2, 0);
  assert.equal(calls, 1);
  g.placePiece(2, 4, 0);
  assert.equal(calls, 2); // все три слота опустели
  assert.equal(gotCount, 3);
  assert.equal(gotBoard, g.board);
  assert.equal(typeof gotRng.next, 'function');
  // previous — id последней полной выдачи; на первом запросе истории нет
  assert.deepEqual(seenPrevious, [null, ['P1', 'P1', 'P1']]);
  assert.deepEqual(g.serialize().lastIssued, ['P1', 'P1', 'P1']);
});

// @spec CORE-MOVE-006
test('trayChanged несёт флаги размещаемости', () => {
  const g = noFitGame({ trayProvider: scripted([p('P1'), p('SQ3'), p('P1')]) });
  assert.deepEqual(g.placeable, [true, false, true]);
  const log = capture(g, ['trayChanged']);
  g.placePiece(0, 3, 3);
  assert.deepEqual(log.at(-1).payload.placeable, [false, false, true]);
});

// @spec CORE-MOVE-007
test('no-fit завершает партию поражением после разрешения конвейера', () => {
  const g = noFitGame();
  const log = capture(g, ['gameOver']);
  g.placePiece(0, 3, 3);
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.result, { outcome: 'loss', reason: 'no-fit' });
  assert.deepEqual(log[0].payload, { outcome: 'loss', reason: 'no-fit' });
});

// @spec CORE-MOVE-008
test('события хода идут в фиксированном порядке конвейера', () => {
  const g = baseGame({
    initialBoard: [...rowCells(0, range(0, 6)), { x: 0, y: 7, color: 1, special: 'bomb', timer: 5 }],
  });
  const names = ['piecePlaced', 'linesCleared', 'boardEmpty', 'scoreChanged', 'streakChanged',
    'bombTick', 'bombExploded', 'fillChanged', 'trayChanged', 'moveResolved', 'gameOver'];
  const log = capture(g, names);
  g.placePiece(0, 7, 0);
  assert.deepEqual(
    log.map((e) => e.n),
    ['piecePlaced', 'linesCleared', 'scoreChanged', 'streakChanged', 'bombTick', 'fillChanged', 'trayChanged', 'moveResolved'],
  );
});

// @spec CORE-MOVE-009
test('счётчик ходов: постановка +1, бустеры бесплатны по умолчанию, undo возвращает', () => {
  const g = baseGame({ initialBoard: [{ x: 5, y: 5, color: 1 }] });
  g.placePiece(0, 0, 0);
  assert.equal(g.moveCount, 1);
  g.applyBooster('hammer', { x: 5, y: 5 });
  assert.equal(g.moveCount, 1);
  g.undo(); // откат молота
  assert.equal(g.moveCount, 1);
  g.undo(); // откат постановки
  assert.equal(g.moveCount, 0);
});

// @spec CORE-MOVE-010
test('moveResolved несёт номер хода, число линий и дельту очков', () => {
  const g = baseGame({
    initialBoard: [...rowCells(0, range(0, 6)), { x: 0, y: 5, color: 1 }], // поле не пустеет
  });
  const log = capture(g, ['moveResolved']);
  g.placePiece(0, 7, 0);
  assert.deepEqual(log[0].payload, { moveCount: 1, clearedCount: 1, scoreDelta: 81 });
});
