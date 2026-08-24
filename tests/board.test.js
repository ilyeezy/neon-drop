import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBoard, canPlace, anyFit, applyInitialBoard, assertBoardInvariants,
  isOccupied, fillRatio,
} from '../src/core/bitboard.js';
import { SHAPE_BY_ID } from '../src/core/shapes.js';
import { createGame } from '../src/core/game.js';
import { baseGame, scripted, p, trioP1, allCellsExcept, capture } from './_helpers.js';

// @spec CORE-BOARD-001
test('поле: только размеры 8/9/10', () => {
  for (const size of [8, 9, 10]) assert.equal(createBoard(size).size, size);
  assert.throws(() => createBoard(7));
  assert.throws(() => createBoard(16));
  assert.throws(() => createGame({ size: 12, trayProvider: scripted(trioP1()) }));
});

// @spec CORE-BOARD-003
test('canPlace: границы, занятость, золото не мешает', () => {
  const b = createBoard(8);
  const sq3 = SHAPE_BY_ID.SQ3;
  assert.equal(canPlace(b, sq3, 0, 0), true);
  assert.equal(canPlace(b, sq3, 5, 5), true);
  assert.equal(canPlace(b, sq3, 6, 5), false); // выход за правую границу
  assert.equal(canPlace(b, sq3, -1, 0), false);
  assert.equal(canPlace(b, sq3, 0, 6), false);
  applyInitialBoard(b, [{ x: 1, y: 1, color: 2 }, { x: 4, y: 4, gold: true }]);
  assert.equal(canPlace(b, sq3, 0, 0), false); // (1,1) занята
  assert.equal(canPlace(b, SHAPE_BY_ID.P1, 4, 4), true); // золото — пустая клетка
});

// @spec CORE-BOARD-004
test('anyFit: находит позицию и честно отвечает «нет»', () => {
  const b = createBoard(8);
  assert.equal(anyFit(b, SHAPE_BY_ID.SQ3), true);
  applyInitialBoard(b, allCellsExcept(8, [[0, 0], [3, 3], [7, 7]]));
  assert.equal(anyFit(b, SHAPE_BY_ID.P1), true);
  assert.equal(anyFit(b, SHAPE_BY_ID.SQ3), false);
  assert.equal(anyFit(b, SHAPE_BY_ID.I2H), false);
});

// @spec CORE-BOARD-002
test('инварианты поля: рассинхрон масок и цветов ловится', () => {
  const b = createBoard(8);
  applyInitialBoard(b, [{ x: 0, y: 0, color: 1 }]);
  assertBoardInvariants(b);
  b.colors[0] = 0; // бит занят, цвета нет
  assert.throws(() => assertBoardInvariants(b));
});

// @spec CORE-BOARD-006, CORE-SPC-003
test('раскладка уровня: невалидные данные отвергаются', () => {
  const mk = () => createBoard(8);
  assert.throws(() => applyInitialBoard(mk(), [{ x: 9, y: 0, color: 1 }]));
  assert.throws(() => applyInitialBoard(mk(), [{ x: 0, y: 0, color: 1, special: 'ice', hp: 3 }]));
  assert.throws(() => applyInitialBoard(mk(), [{ x: 0, y: 0, color: 1, special: 'bomb', timer: 0 }]));
  assert.throws(() => applyInitialBoard(mk(), [{ x: 0, y: 0, special: 'stone' }])); // спецблок без блока
  assert.throws(() => applyInitialBoard(mk(), [{ x: 0, y: 0, color: 1, special: 'ice', gold: true }]));
  assert.throws(() => applyInitialBoard(mk(), [{ x: 0, y: 0, color: 1, gold: true }])); // золото только на пустой
  assert.throws(() => applyInitialBoard(mk(), [{ x: 0, y: 0, color: 1, special: 'bomb', gold: true }]));
  assert.throws(() => applyInitialBoard(mk(), [{ x: 0, y: 0, color: 1, special: 'comet' }]));
  const b = applyInitialBoard(mk(), [
    { x: 0, y: 0, color: 1, special: 'ice', hp: 2 },
    { x: 1, y: 0, color: 2, special: 'bomb', timer: 5 },
    { x: 2, y: 0, color: 3, special: 'stone' },
    { x: 3, y: 0, gold: true },
  ]);
  assert.equal(isOccupied(b, 3, 0), false);
});

// @spec CORE-BOARD-005
test('fillChanged публикуется с корректной заполненностью', () => {
  const g = baseGame({ trayProvider: scripted([p('T4_0', 3), p('P1'), p('P1')]) });
  const log = capture(g, ['fillChanged']);
  g.placePiece(0, 0, 0);
  assert.equal(log.length, 1); // ровно один раз за ход, без промежуточных значений
  assert.equal(log[0].payload.ratio, 4 / 64);
  assert.equal(fillRatio(g.board), 4 / 64);
});
