import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragOriginPx, dragTarget, linesAfterPlace, evaluateDrag, dragOriginFromAnchor, SNAP_RADIUS, DRAG_GAIN, MOUSE_GAIN } from '../src/input/drag-logic.js';
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

// Без усиления путь пальца от трея до дальнего края поля равен почти всей
// высоте экрана — главная жалоба на управление с телефона.
// @spec INPUT-LOG-007
test('усиление хода: фигура проходит больше пальца, мышь — один к одному', () => {
  const shape = SHAPE_BY_ID.P1;
  const anchor = { pointer: { x: 200, y: 600 }, origin: dragOriginPx(200, 600, shape, 40, 100) };
  // палец поднялся на 100 px — фигура должна пройти заметно больше
  const moved = dragOriginFromAnchor(anchor, 200, 500);
  assert.equal(Math.round(anchor.origin.y - moved.y), Math.round(100 * DRAG_GAIN.y));
  assert.ok(DRAG_GAIN.y > 1.4, 'вертикальное усиление ощутимо');
  assert.ok(DRAG_GAIN.y > DRAG_GAIN.x, 'по вертикали дистанция больше, усиление сильнее');
  // мышью ход один к одному: на десктопе рука и так дотягивается
  const byMouse = dragOriginFromAnchor(anchor, 260, 500, MOUSE_GAIN);
  assert.equal(byMouse.y, anchor.origin.y - 100);
  assert.equal(byMouse.x, anchor.origin.x + 60);
});

test('в точке подъёма фигура стоит там же, куда её положил подъём', () => {
  const shape = SHAPE_BY_ID.SQ2;
  const origin = dragOriginPx(180, 640, shape, 40, 112);
  const anchor = { pointer: { x: 180, y: 640 }, origin };
  assert.deepEqual(dragOriginFromAnchor(anchor, 180, 640), origin); // усиление от нуля — ноль
});

test('усиление участвует в оценке кадра и двигает цель быстрее пальца', () => {
  const board = createBoard(8);
  const shape = SHAPE_BY_ID.P1;
  const opts = { cellPx: 40, boardOriginPx: { x: 100, y: 50 }, liftPx: 40 };
  const start = { x: 300, y: 500 };
  const anchor = { pointer: start, origin: dragOriginPx(start.x, start.y, shape, 40, 40) };
  const plain = evaluateDrag(board, shape, start.x, start.y - 200, opts);
  const boosted = evaluateDrag(board, shape, start.x, start.y - 200, { ...opts, anchor });
  assert.ok(boosted.originPx.y < plain.originPx.y, 'с усилением фигура выше при том же пальце');
});
