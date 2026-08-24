import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseGame, scripted, p, trioP1, rowCells, range, capture, comparable } from './_helpers.js';
import { isOccupied, hasGold } from '../src/core/bitboard.js';
import { SPECIAL } from '../src/core/specials.js';

const specialsBoard = () => [
  { x: 2, y: 2, color: 1, special: 'stone' },
  { x: 4, y: 4, color: 2, special: 'bomb', timer: 3 },
  { x: 6, y: 6, color: 3, special: 'ice', hp: 2 },
  { x: 1, y: 1, gold: true }, // золото в раскладке — только на пустой клетке
  { x: 0, y: 4, color: 5, special: 'bomb', timer: 3 },
];

// @spec CORE-BST-001, CORE-SPC-004
test('молот сносит любой спецблок целиком, не трогая стрик и бомбы', () => {
  const g = baseGame({ initialBoard: [...rowCells(0, range(0, 6)), ...specialsBoard()] });
  g.placePiece(0, 1, 1); // накрываем золото обычным блоком
  g.placePiece(1, 7, 0); // очистка → стрик 1
  assert.equal(g.streakStep, 1);
  for (const [x, y] of [[2, 2], [4, 4], [6, 6], [1, 1]]) {
    assert.equal(g.applyBooster('hammer', { x, y }).ok, true);
    assert.equal(isOccupied(g.board, x, y), false);
    assert.equal(g.board.specials[y * 8 + x], SPECIAL.NONE);
  }
  assert.equal(hasGold(g.board, 1, 1), true); // золото пережило молот
  assert.equal(g.board.specialData[4 * 8 + 0], 1); // две постановки тикнули, молоты — нет
  assert.equal(g.streakStep, 1); // стрик не тронут
});

// @spec CORE-BST-002
test('молот по пустой клетке отвергается', () => {
  const g = baseGame();
  const before = JSON.stringify(g.serialize());
  assert.deepEqual(g.applyBooster('hammer', { x: 3, y: 3 }), { ok: false, reason: 'empty' });
  assert.equal(JSON.stringify(g.serialize()), before);
});

// @spec CORE-BST-003
test('перемешивание меняет ровно занятые слоты и не участвует в анти-повторе', () => {
  const calls = [];
  const provider = (board, rng, opts) => {
    calls.push({ count: opts.count, previous: opts.previous ?? null });
    const shape = calls.length === 1 ? 'P1' : 'SQ2';
    return Array.from({ length: opts.count }, () => p(shape, 2));
  };
  const g = baseGame({ trayProvider: provider });
  g.placePiece(0, 0, 0);
  g.placePiece(1, 2, 2); // в трее одна фигура в слоте 2
  assert.equal(g.applyBooster('shuffle').ok, true);
  assert.deepEqual(g.tray.map((t) => (t ? t.shapeId : null)), [null, null, 'SQ2']);
  assert.deepEqual(g.placeable, [false, false, true]); // остаток тройки не «смыт»
  assert.deepEqual(calls, [
    { count: 3, previous: null },
    { count: 1, previous: null }, // перемешивание previous не получает
  ]);
  assert.deepEqual(g.serialize().lastIssued, ['P1', 'P1', 'P1']); // и lastIssued не обновляет
});

// @spec CORE-BST-004
test('undo атомарно восстанавливает всё состояние', () => {
  const g = baseGame({ initialBoard: specialsBoard() });
  g.placePiece(0, 0, 0);
  const afterMove = JSON.stringify(comparable(g.serialize()));
  const log = capture(g, ['undoApplied']);
  g.applyBooster('hammer', { x: 4, y: 4 });
  assert.notEqual(JSON.stringify(comparable(g.serialize())), afterMove);
  assert.equal(g.undo().ok, true);
  assert.equal(JSON.stringify(comparable(g.serialize())), afterMove);
  assert.equal(log.length, 1);
  assert.equal(log[0].payload.undoLeft, 98);
});

// @spec CORE-BST-005
test('кольцо undo: глубина 5, снапшот до мутации', () => {
  const g = baseGame();
  const spots = [[0, 0], [2, 0], [4, 0], [6, 0], [0, 2], [2, 2], [4, 2]];
  for (const [x, y] of spots) {
    const slot = g.tray.findIndex(Boolean);
    assert.equal(g.placePiece(slot, x, y).ok, true);
  }
  assert.equal(g.moveCount, 7);
  for (let i = 0; i < 5; i++) assert.equal(g.undo().ok, true);
  assert.equal(g.moveCount, 2); // откатились ровно на глубину кольца
  assert.deepEqual(g.undo(), { ok: false, reason: 'empty' });
});

// @spec CORE-BST-007
test('молот и перемешивание не сбрасывают стрик', () => {
  const g = baseGame({ initialBoard: [...rowCells(0, range(0, 6)), { x: 0, y: 5, color: 1 }] });
  g.placePiece(0, 7, 0);
  assert.equal(g.streakStep, 1);
  g.applyBooster('hammer', { x: 0, y: 5 });
  assert.equal(g.streakStep, 1);
  g.applyBooster('shuffle');
  assert.equal(g.streakStep, 1);
});

// @spec CORE-BST-008, CORE-MOVE-004
test('флаги стоимости: молот тратит ход и тикает бомбы', () => {
  const g = baseGame({
    boosterCostsMove: true,
    boosterTicksBombs: true,
    initialBoard: [{ x: 5, y: 5, color: 1 }, { x: 0, y: 7, color: 1, special: 'bomb', timer: 3 }],
  });
  const log = capture(g, ['bombTick']);
  g.applyBooster('hammer', { x: 5, y: 5 });
  assert.equal(g.moveCount, 1);
  assert.deepEqual(log[0].payload.timers, [2]);
});

// @spec CORE-BST-009
test('boosterApplied публикуется с типом бустера и остатком', () => {
  const g = baseGame({ initialBoard: [{ x: 5, y: 5, color: 1 }] });
  const log = capture(g, ['boosterApplied']);
  g.applyBooster('hammer', { x: 5, y: 5 });
  g.applyBooster('shuffle');
  assert.deepEqual(log.map((e) => [e.payload.type, e.payload.left]), [['hammer', 98], ['shuffle', 98]]);
});

// @spec CORE-BST-010
test('запас: применение при нуле отвергается, расход не возвращается отменой', () => {
  const empty = baseGame({ boosters: { hammer: 0, shuffle: 0, undo: 0 }, initialBoard: [{ x: 5, y: 5, color: 1 }] });
  assert.deepEqual(empty.applyBooster('hammer', { x: 5, y: 5 }), { ok: false, reason: 'no-stock' });
  assert.deepEqual(empty.applyBooster('shuffle'), { ok: false, reason: 'no-stock' });
  empty.placePiece(0, 0, 0);
  assert.deepEqual(empty.undo(), { ok: false, reason: 'no-stock' });

  const g = baseGame({ boosters: { hammer: 1, shuffle: 0, undo: 1 }, initialBoard: [{ x: 5, y: 5, color: 1 }] });
  g.applyBooster('hammer', { x: 5, y: 5 });
  assert.equal(g.serialize().boosters.hammer, 0);
  assert.equal(g.undo().ok, true); // откат молота
  assert.equal(g.serialize().boosters.hammer, 0); // молот не вернулся
  assert.equal(g.serialize().boosters.undo, 0);   // отмена потрачена
});

// @spec CORE-BST-011
test('addBoosters пополняет запас с событием; из over — отвергается', () => {
  const g = baseGame({ boosters: { hammer: 0, shuffle: 0, undo: 0 } });
  const log = capture(g, ['boosterStockChanged']);
  assert.equal(g.addBoosters({ hammer: 3 }).ok, true);
  assert.deepEqual(log[0].payload.stock, { hammer: 3, shuffle: 0, undo: 0 });
  assert.equal(g.addBoosters({ jetpack: 1 }).ok, false);
  g.end('loss', 'quit');
  assert.equal(g.addBoosters({ hammer: 3 }).ok, false);
});
