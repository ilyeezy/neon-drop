import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseGame, scripted, p, rowCells, range, capture, trioP1, FULL_STOCK,
} from './_helpers.js';
import { BALANCE } from '../src/core/balance.js';

const clearX10000 = (n, size, step) => n * BALANCE.clearBase * size
  * BALANCE.multiBonusX100[Math.min(n, BALANCE.multiBonusX100.length) - 1]
  * BALANCE.streakLadderX100[Math.min(step, BALANCE.streakLadderX100.length - 1)];

const moveDelta = (cellPts, x10000) => Math.floor((cellPts * 10000 + x10000) / 10000);

const EMPTY_BONUS = 8 * BALANCE.emptyBoardBonusPerSize;

// @spec CORE-SCORE-001, CORE-SCORE-005
test('очистка n линий: формула и множители из balance.js', () => {
  const cases = [
    { n: 1, piece: 'P1' }, { n: 2, piece: 'I2V' }, { n: 3, piece: 'I3V' },
    { n: 4, piece: 'I4V' }, { n: 5, piece: 'I5V' },
  ];
  for (const { n, piece } of cases) {
    const g = baseGame({
      initialBoard: range(0, n - 1).flatMap((y) => rowCells(y, range(0, 6))),
      trayProvider: scripted([p(piece), p('P1'), p('P1')]),
    });
    const res = g.placePiece(0, 7, 0);
    assert.equal(res.cleared, n);
    // поле пустеет целиком — бонус входит в сумму хода
    assert.equal(res.scoreDelta, moveDelta(n + EMPTY_BONUS, clearX10000(n, 8, 0)), `n=${n}`);
  }
});

// @spec CORE-SCORE-002
test('стрик: текущий ход получает заработанную ступень, сброс публикуется один раз', () => {
  const g = baseGame({
    initialBoard: [...rowCells(0, range(0, 6)), ...rowCells(1, range(0, 6))],
  });
  const log = capture(g, ['streakChanged']);
  const r1 = g.placePiece(0, 7, 0); // первая очистка серии — ×1
  assert.equal(r1.scoreDelta, moveDelta(1, clearX10000(1, 8, 0)));
  assert.deepEqual(log.at(-1).payload, { step: 1, mult: BALANCE.streakLadderX100[1] / 100 });
  const r2 = g.placePiece(1, 7, 1); // вторая подряд — ступень 1, после неё поле пусто
  assert.equal(r2.scoreDelta, moveDelta(1 + EMPTY_BONUS, clearX10000(1, 8, 1)));
  assert.deepEqual(log.at(-1).payload, { step: 2, mult: BALANCE.streakLadderX100[2] / 100 });
  const events = log.length;
  g.placePiece(2, 0, 0); // без очистки — ступень держится до конца раздачи
  assert.equal(g.streakStep, 2);
  assert.equal(log.length, events);
});

// @spec CORE-SCORE-003
test('бонус пустого поля начисляется и публикуется', () => {
  const g = baseGame({ initialBoard: rowCells(0, range(0, 6)) });
  const log = capture(g, ['boardEmpty']);
  const res = g.placePiece(0, 7, 0);
  assert.equal(res.scoreDelta, 1 + 80 + EMPTY_BONUS);
  assert.equal(log.length, 1);
});

// @spec CORE-SCORE-004
test('дробные множители: целочисленный тракт, одно отбрасывание дроби на итоге', () => {
  const g = baseGame({
    initialBoard: [
      ...range(0, 2).flatMap((y) => rowCells(y, range(0, 6))),
      ...rowCells(5, range(0, 6)),
      { x: 0, y: 7, color: 1 }, // поле не пустеет — бонус не участвует
    ],
    trayProvider: scripted([p('P1'), p('I3V'), p('P1')]),
  });
  g.placePiece(0, 7, 5); // одиночная очистка, стрик → ступень 1
  const res = g.placePiece(1, 7, 0); // 3 линии на ступени 1: ×2.2 × ×1.2 = 633.6
  assert.equal(res.scoreDelta, moveDelta(3, clearX10000(3, 8, 1)));
  assert.equal(res.scoreDelta, 636); // не 637 (round) и без double-хвостов вида 636.9999
});

// @spec CORE-SCORE-002
test('стрик живёт раздачу: сброс только после тройки без единой очистки', () => {
  const g = baseGame({
    initialBoard: [...rowCells(0, range(0, 6)), ...rowCells(1, range(0, 6))],
    trayProvider: scripted(trioP1(), trioP1(), trioP1()),
  });
  const log = capture(g, ['streakChanged']);
  g.placePiece(0, 7, 0); // очистка — ступень 1
  assert.equal(g.streakStep, 1);
  g.placePiece(1, 7, 1); // очистка — ступень 2
  assert.equal(g.streakStep, 2);
  g.placePiece(2, 0, 0); // раздача дожата без очистки, но очистки в ней были
  assert.equal(g.streakStep, 2, 'раздача с очисткой стрик не гасит');
  const events = log.length;
  g.placePiece(0, 1, 0); // новая раздача, ходы без очисток
  g.placePiece(1, 2, 0);
  assert.equal(g.streakStep, 2, 'внутри раздачи ступень держится');
  g.placePiece(2, 3, 0); // тройка дожата, очисток не было — гасим
  assert.equal(g.streakStep, 0);
  assert.deepEqual(log.at(-1).payload, { step: 0, mult: BALANCE.streakLadderX100[0] / 100 });
  assert.ok(log.length > events);
});

// @spec CORE-SCORE-002, CORE-BST-007
test('перемешивание не считается концом раздачи', () => {
  const g = baseGame({
    initialBoard: rowCells(0, range(0, 6)),
    trayProvider: scripted(trioP1(), trioP1(), trioP1()),
    boosters: FULL_STOCK,
  });
  g.placePiece(0, 7, 0); // очистка — ступень 1
  assert.equal(g.streakStep, 1);
  g.applyBooster('shuffle');
  assert.equal(g.streakStep, 1, 'перемешивание стрик не трогает');
  g.placePiece(0, 0, 5);
  g.placePiece(1, 1, 5);
  assert.equal(g.streakStep, 1, 'раздача ещё не дожата');
});
