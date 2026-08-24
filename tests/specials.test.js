import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseGame, rowCells, range, capture } from './_helpers.js';
import { isOccupied, hasGold, boardIsEmpty } from '../src/core/bitboard.js';
import { canPlace } from '../src/core/bitboard.js';
import { SHAPE_BY_ID } from '../src/core/shapes.js';
import { SPECIAL } from '../src/core/specials.js';

const at = (g, x, y) => g.board.specials[y * g.board.size + x];
const dataAt = (g, x, y) => g.board.specialData[y * g.board.size + x];

// @spec CORE-SPC-001
test('очистка снимает обычные клетки полностью', () => {
  const g = baseGame({ initialBoard: rowCells(0, range(0, 6)) });
  g.placePiece(0, 7, 0);
  assert.equal(boardIsEmpty(g.board), true);
});

// @spec CORE-SPC-002
test('лёд hp1: корка снята, клетка остаётся занятой — строка не пуста', () => {
  const g = baseGame({
    initialBoard: [...rowCells(0, range(0, 6)).map((c) => (c.x === 2 ? { ...c, special: 'ice' } : c))],
  });
  const log = capture(g, ['linesCleared']);
  g.placePiece(0, 7, 0);
  const res = log[0].payload;
  assert.equal(res.removedCells.length, 7);
  assert.deepEqual(res.iceDamaged, [{ x: 2, y: 0, hp: 0 }]);
  assert.equal(isOccupied(g.board, 2, 0), true);
  assert.equal(at(g, 2, 0), SPECIAL.NONE);
  assert.equal(boardIsEmpty(g.board), false);
});

// @spec CORE-SPC-002, CORE-SPC-003
test('лёд hp2: первая очистка оставляет лёд с hp1', () => {
  const g = baseGame({
    initialBoard: [...rowCells(0, range(0, 6)).map((c) => (c.x === 2 ? { ...c, special: 'ice', hp: 2 } : c))],
  });
  const log = capture(g, ['linesCleared']);
  g.placePiece(0, 7, 0);
  assert.deepEqual(log[0].payload.iceDamaged, [{ x: 2, y: 0, hp: 1 }]);
  assert.equal(at(g, 2, 0), SPECIAL.ICE);
  assert.equal(dataAt(g, 2, 0), 1);
});

// @spec CORE-SPC-004
test('камень: блокирует постановку, снимается очисткой', () => {
  const g = baseGame({
    initialBoard: [...rowCells(0, range(0, 6)).map((c) => (c.x === 3 ? { ...c, special: 'stone' } : c))],
  });
  assert.equal(canPlace(g.board, SHAPE_BY_ID.P1, 3, 0), false);
  const log = capture(g, ['linesCleared']);
  g.placePiece(0, 7, 0);
  const removedStone = log[0].payload.removedCells.find((c) => c.x === 3 && c.y === 0);
  assert.equal(removedStone.special, SPECIAL.STONE);
  assert.equal(isOccupied(g.board, 3, 0), false);
});

// @spec CORE-SPC-005, CORE-MOVE-004
test('бомба в сгоревшей линии обезврежена и не тикает этим ходом', () => {
  const g = baseGame({
    initialBoard: [...rowCells(0, range(0, 6)).map((c) => (c.x === 4 ? { ...c, special: 'bomb', timer: 1 } : c))],
  });
  const log = capture(g, ['linesCleared', 'bombTick', 'bombExploded']);
  g.placePiece(0, 7, 0);
  assert.deepEqual(log.find((e) => e.n === 'linesCleared').payload.defusedBombs, [{ x: 4, y: 0 }]);
  assert.equal(log.some((e) => e.n === 'bombTick'), false);
  assert.equal(log.some((e) => e.n === 'bombExploded'), false); // с timer 1 тик означал бы взрыв
});

// @spec CORE-SPC-006, CORE-MOVE-004
test('бомба тикает на каждую постановку; ноль — событие, не гейм-овер', () => {
  const g = baseGame({ initialBoard: [{ x: 0, y: 7, color: 1, special: 'bomb', timer: 2 }] });
  const log = capture(g, ['bombTick', 'bombExploded']);
  g.placePiece(0, 3, 3);
  assert.deepEqual(log.at(-1).payload.timers, [1]);
  g.placePiece(1, 4, 4);
  assert.ok(log.some((e) => e.n === 'bombExploded'));
  assert.equal(g.phase, 'playing'); // поражение объявляет режим, не ядро
});

// @spec CORE-SPC-007
test('золото засчитывается очисткой линии через клетку', () => {
  const g = baseGame({
    initialBoard: [...rowCells(0, [0, 1, 2, 3, 4, 6, 7]), { x: 5, y: 0, gold: true }],
  });
  const log = capture(g, ['linesCleared']);
  g.placePiece(0, 5, 0);
  assert.deepEqual(log[0].payload.goldCleared, [{ x: 5, y: 0 }]);
  assert.equal(hasGold(g.board, 5, 0), false);
});

// @spec CORE-SPC-008
test('накрытие и молот золото не засчитывают', () => {
  const g = baseGame({ initialBoard: [{ x: 5, y: 0, gold: true }] });
  g.placePiece(0, 5, 0); // накрыли — очистки нет
  assert.equal(hasGold(g.board, 5, 0), true);
  g.applyBooster('hammer', { x: 5, y: 0 });
  assert.equal(isOccupied(g.board, 5, 0), false);
  assert.equal(hasGold(g.board, 5, 0), true); // золото пережило молот
});

// @spec CORE-SPC-009
test('у спецблоков нет отдельного скоринга: линия с камнем и льдом стоит как обычная', () => {
  const plain = baseGame({ initialBoard: rowCells(0, range(0, 6)) });
  plain.placePiece(0, 7, 0);
  const special = baseGame({
    initialBoard: rowCells(0, range(0, 6)).map((c) => {
      if (c.x === 1) return { ...c, special: 'stone' };
      if (c.x === 2) return { ...c, special: 'bomb', timer: 5 };
      return c;
    }),
  });
  special.placePiece(0, 7, 0);
  assert.equal(special.score, plain.score);
});
