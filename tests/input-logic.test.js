import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragOriginPx, dragTarget, linesAfterPlace, evaluateDrag, SNAP_RADIUS } from '../src/input/drag-logic.js';
import { createBoard, applyInitialBoard } from '../src/core/bitboard.js';
import { SHAPE_BY_ID } from '../src/core/shapes.js';
import { rowCells, range } from './_helpers.js';

const opts = { cellPx: 40, boardOriginPx: { x: 100, y: 50 }, liftPx: 60 };

// @spec INPUT-LOG-002
test('позиция отрисовки: центр по X на указателе, подъём над пальцем', () => {
  const sq2 = SHAPE_BY_ID.SQ2;
  const origin = dragOriginPx(300, 400, sq2, 40, 60);
  assert.deepEqual(origin, { x: 300 - 40, y: 400 - 60 - 40 });
  const mouse = dragOriginPx(300, 400, sq2, 40, 12); // мышь — малый сдвиг
  assert.equal(mouse.y, 400 - 12 - 40);
});

// @spec INPUT-LOG-003
test('снап: ближайшая валидная позиция в радиусе 0.7, магнит к соседней', () => {
  const board = createBoard(8);
  const sq2 = SHAPE_BY_ID.SQ2;
  const at = (b, gx, gy) => dragTarget(b, sq2, { x: 100 + gx * 40, y: 50 + gy * 40 }, opts.boardOriginPx, 40);
  assert.deepEqual(at(board, 2.3, 3.6), { x: 2, y: 4, valid: true });
  assert.deepEqual(at(board, 2.69, 3.0), { x: 3, y: 3, valid: true });
  assert.deepEqual(at(board, 0, 0), { x: 0, y: 0, valid: true });
  // магнит: ближайшая (2,2) занята — прилипаем к валидной (3,2) в радиусе
  const blocked = applyInitialBoard(createBoard(8), [{ x: 2, y: 2, color: 1 }]);
  assert.deepEqual(at(blocked, 2.3, 2.0), { x: 3, y: 2, valid: true });
  assert.ok(SNAP_RADIUS > 0.5); // радиус и есть магнит — иначе он мёртвая логика
});

// @spec INPUT-LOG-004
test('вне поля цель null — возврат в трей без штрафа', () => {
  const board = createBoard(8);
  const sq3 = SHAPE_BY_ID.SQ3;
  assert.equal(dragTarget(board, sq3, { x: 100 - 80, y: 50 }, opts.boardOriginPx, 40), null);
  assert.equal(dragTarget(board, sq3, { x: 100 + 6 * 40, y: 50 }, opts.boardOriginPx, 40), null); // 6+3 > 8
  assert.equal(dragTarget(board, sq3, { x: 100, y: 50 + 6 * 40 }, opts.boardOriginPx, 40), null);
});

// @spec INPUT-LOG-005
test('валидность цели — canPlace ядра', () => {
  const board = applyInitialBoard(createBoard(8), [{ x: 2, y: 2, color: 1 }]);
  const sq2 = SHAPE_BY_ID.SQ2;
  const pointerFor = (cx, cy) => ({
    x: opts.boardOriginPx.x + cx * 40 + 40, // центр фигуры 2×2
    y: opts.boardOriginPx.y + cy * 40 + 40 + opts.liftPx,
  });
  const bad = evaluateDrag(board, sq2, pointerFor(2, 2).x, pointerFor(2, 2).y, opts);
  assert.deepEqual(bad.target, { x: 2, y: 2 });
  assert.equal(bad.valid, false);
  const good = evaluateDrag(board, sq2, pointerFor(4, 4).x, pointerFor(4, 4).y, opts);
  assert.equal(good.valid, true);
});

// @spec INPUT-LOG-006
test('подсветка будущего сгорания: симуляция масками ядра', () => {
  const board = applyInitialBoard(createBoard(8), rowCells(0, range(0, 6)));
  const p1 = SHAPE_BY_ID.P1;
  assert.deepEqual(linesAfterPlace(board, p1, 7, 0), { rows: [0], cols: [] });
  assert.deepEqual(linesAfterPlace(board, p1, 7, 3), { rows: [], cols: [] });
});

// @spec INPUT-LOG-001
test('чистота: одинаковые входы — одинаковый результат, вход не мутируется', () => {
  const board = applyInitialBoard(createBoard(8), rowCells(0, range(0, 6)));
  const before = JSON.stringify([...board.masks]);
  const shape = SHAPE_BY_ID.I3H;
  const a = evaluateDrag(board, shape, 260, 130, opts);
  const b = evaluateDrag(board, shape, 260, 130, opts);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify([...board.masks]), before);
});
