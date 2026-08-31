import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createGenerator, isFullyPlayable, shapeWeight } from '../src/core/generator.js';
import { createRng } from '../src/core/rng.js';
import { SHAPES, SHAPE_BY_ID } from '../src/core/shapes.js';
import { BALANCE } from '../src/core/balance.js';
import { createBoard, applyInitialBoard, anyFit } from '../src/core/bitboard.js';
import { createGame } from '../src/core/game.js';
import { allCellsExcept, scripted, trioP1, p, rowCells, range, FULL_STOCK } from './_helpers.js';
import { greedyMove, randomMove } from '../tools/bots.js';

const emptyBoard = () => createBoard(8);
const scatteredBoard = () => applyInitialBoard(createBoard(8), // fill 0.31, корзина «база»
  range(0, 4).flatMap((y) => rowCells(y, range(0, 3))));
const crowdedBoard = () => applyInitialBoard(createBoard(8), // изолированные дырки
  allCellsExcept(8, [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7]]));
const denseBoard = () => applyInitialBoard(createBoard(8), (() => { // fill 0.59, «тесно»
  const cells = [];
  for (let c = 0; c <= 4; c++) for (let y = 0; y < 8; y++) if (y !== c) cells.push({ x: c, y, color: 1 });
  for (let y = 0; y <= 2; y++) cells.push({ x: 5, y, color: 1 });
  return cells;
})());

// веса берём из самого генератора: дублировать формулу в тесте — значит
// ловить не баги, а расхождение двух копий правила
const weightsLow = SHAPES.map((s) => shapeWeight(s, 0));
const weightsHigh = SHAPES.map((s) => shapeWeight(s, 0.9));

function valueFor(shapeId, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < SHAPES.length; i++) {
    if (SHAPES[i].id === shapeId) return (acc + weights[i] / 2) / total;
    acc += weights[i];
  }
  throw new Error(`no shape ${shapeId}`);
}

function stubRng(values) {
  let i = 0;
  const next = () => {
    if (i >= values.length) throw new Error(`stub rng exhausted at ${i}`);
    return values[i++];
  };
  return { next, int: (n) => Math.floor(next() * n), getState: () => i, setState: () => {}, used: () => i };
}

// @spec GEN-PICK-001
test('выдача: ровно count пар, id из каталога, цвета 1..7', () => {
  const gen = createGenerator();
  const rng = createRng(7);
  for (let i = 0; i < 200; i++) {
    const count = 1 + (i % 3);
    const pieces = gen(emptyBoard(), rng, { count });
    assert.equal(pieces.length, count);
    for (const piece of pieces) {
      assert.ok(SHAPE_BY_ID[piece.shapeId], piece.shapeId);
      assert.ok(piece.color >= 1 && piece.color <= 7);
    }
  }
});

// @spec GEN-PICK-002
test('адаптация: пустое поле сдвигает к крупным, тесное — к мелким и линиям', () => {
  const gen = createGenerator();
  const meanSize = (board, seed) => {
    const rng = createRng(seed);
    let cells = 0;
    for (let i = 0; i < 400; i++) {
      for (const piece of gen(board, rng, { count: 3 })) cells += SHAPE_BY_ID[piece.shapeId].size;
    }
    return cells / 1200;
  };
  const lineShare = (board, seed) => {
    const rng = createRng(seed);
    let lines = 0;
    for (let i = 0; i < 400; i++) {
      for (const piece of gen(board, rng, { count: 3 })) {
        if (/^I[2345][HV]$/.test(piece.shapeId)) lines += 1;
      }
    }
    return lines / 1200;
  };
  const low = meanSize(emptyBoard(), 11);
  const mid = meanSize(scatteredBoard(), 11);
  assert.ok(low > mid + 0.2, `пусто ${low} должно быть крупнее базы ${mid}`);
  const shareMid = lineShare(scatteredBoard(), 13);
  const shareHigh = lineShare(denseBoard(), 13);
  assert.ok(shareHigh > shareMid, `линии в тесноте ${shareHigh} ≤ базы ${shareMid}`);
});

// @spec GEN-PICK-003
test('рулетка: один next() на фигуру, кламп на границе double', () => {
  const edge = 1 - Number.EPSILON;
  const rng = stubRng([edge, edge]);
  const gen = createGenerator();
  const pieces = gen(emptyBoard(), rng, { count: 1, fairMode: true });
  assert.ok(SHAPE_BY_ID[pieces[0].shapeId]); // не вылетели за последнюю корзину
  assert.equal(rng.used(), 2); // 1 форма + 1 цвет
});

// @spec GEN-PICK-004, GEN-ANTI-002
test('отклонённый набор тратит PRNG только на формы; повтор previous отвергается', () => {
  const vP1 = valueFor('P1', weightsLow);
  const vSQ2 = valueFor('SQ2', weightsLow);
  const rng = stubRng([vP1, vP1, vP1, vSQ2, vSQ2, vSQ2, 0.1, 0.4, 0.7]);
  const gen = createGenerator();
  const pieces = gen(emptyBoard(), rng, { count: 3, previous: ['P1', 'P1', 'P1'] });
  assert.deepEqual(pieces.map((x) => x.shapeId), ['SQ2', 'SQ2', 'SQ2']);
  assert.deepEqual(pieces.map((x) => x.color), [1, 3, 5]);
  assert.equal(rng.used(), 9); // 3 формы отклонённого + 3 формы принятого + 3 цвета
});

// @spec GEN-PICK-005
test('три совпавших цвета: ровно один перевыбор третьего слота', () => {
  const vP1 = valueFor('P1', SHAPES.map((s) => s.weight));
  const rng = stubRng([vP1, vP1, vP1, 0.0, 0.05, 0.1, 0.5]);
  const gen = createGenerator();
  const pieces = gen(emptyBoard(), rng, { count: 3, fairMode: true });
  assert.deepEqual(pieces.map((x) => x.color), [1, 1, 4]);
  assert.equal(rng.used(), 7); // 3 формы + 3 цвета + 1 перевыбор
});

// @spec GEN-GUAR-001
test('гарантия: в каждой выдаче есть размещаемая фигура', () => {
  const gen = createGenerator();
  const rng = createRng(21);
  const board = crowdedBoard();
  for (let i = 0; i < 300; i++) {
    const pieces = gen(board, rng, { count: 3 });
    assert.ok(pieces.some((piece) => anyFit(board, SHAPE_BY_ID[piece.shapeId])));
  }
});

// @spec GEN-GUAR-002, GEN-GUAR-003
test('исчерпание попыток: форс P1 без PRNG на форму, поток предсказуем', () => {
  const board = crowdedBoard(); // fill 0.875 — «тесная» корзина, SQ3 некуда ставить
  const vSQ3 = valueFor('SQ3', weightsHigh);
  const attempts = BALANCE.generator.maxAttempts;
  const values = [...Array(attempts * 3).fill(vSQ3), 0.1, 0.4, 0.7];
  const rng = stubRng(values);
  const gen = createGenerator();
  const pieces = gen(board, rng, { count: 3 }); // каждая попытка — [SQ3×3], анти-паттерн
  assert.deepEqual(pieces.map((x) => x.shapeId), ['SQ3', 'SQ3', 'P1']);
  assert.equal(rng.used(), attempts * 3 + 3); // формы всех попыток + 3 цвета, форс бесплатен
});

// @spec GEN-ANTI-001
test('анти-паттерны: ни трёх одинаковых крупных, ни трёх SQ3', () => {
  const gen = createGenerator();
  const rng = createRng(31);
  for (let i = 0; i < 4000; i++) {
    const ids = gen(emptyBoard(), rng, { count: 3 }).map((x) => x.shapeId);
    const allSame = ids[0] === ids[1] && ids[1] === ids[2];
    assert.ok(!(allSame && SHAPE_BY_ID[ids[0]].size >= BALANCE.generator.largeSize), ids.join());
    assert.ok(!ids.every((id) => id === 'SQ3'));
  }
});

// @spec GEN-ANTI-002
test('анти-повтор: выдача не совпадает с previous как мультимножество', () => {
  const gen = createGenerator();
  const rng = createRng(37);
  let previous = null;
  for (let i = 0; i < 1500; i++) {
    const ids = gen(emptyBoard(), rng, { count: 3, previous }).map((x) => x.shapeId).sort();
    if (previous) assert.notDeepEqual(ids, [...previous].sort());
    previous = ids;
  }
});

// @spec GEN-SOLV-001
test('isFullyPlayable: разыгрываемость, неразыгрываемость, мемоизация', () => {
  const stats = { solverCalls: 0, solverNodes: [] };
  assert.equal(isFullyPlayable(emptyBoard(), [SHAPE_BY_ID.P1, SHAPE_BY_ID.P1, SHAPE_BY_ID.P1]), true);
  const twoHoles = applyInitialBoard(createBoard(8),
    allCellsExcept(8, [[0, 0], [4, 4], [7, 7]]));
  assert.equal(isFullyPlayable(twoHoles, [SHAPE_BY_ID.P1, SHAPE_BY_ID.P1], undefined, stats), true);
  assert.equal(isFullyPlayable(twoHoles, [SHAPE_BY_ID.I2H]), false);
  // мультимножество: три одинаковые фигуры не порождают 3! перестановок
  const identical = { solverCalls: 0, solverNodes: [] };
  assert.equal(isFullyPlayable(emptyBoard(), [SHAPE_BY_ID.SQ3, SHAPE_BY_ID.SQ3, SHAPE_BY_ID.SQ3],
    undefined, identical), true);
  assert.ok(identical.solverNodes[0] < 100, `узлов: ${identical.solverNodes[0]}`);
});

// @spec GEN-SOLV-002
test('isFullyPlayable: исчерпание бюджета — «не доказано», не «нет»', () => {
  const res = isFullyPlayable(scatteredBoard(),
    [SHAPE_BY_ID.SQ3, SHAPE_BY_ID.SQ3, SHAPE_BY_ID.SQ3], 2);
  assert.equal(res, null); // поиск велик, бюджет в 2 узла заведомо мал
});

// @spec GEN-SOLV-003
test('requireFullSolvable: выдача доказанно разыгрываема, при нехватке бюджета — обычная гарантия', () => {
  const gen = createGenerator({ requireFullSolvable: true });
  const rng = createRng(41);
  const board = scatteredBoard();
  for (let i = 0; i < 30; i++) {
    const pieces = gen(board, rng, { count: 3 });
    const shapes = pieces.map((piece) => SHAPE_BY_ID[piece.shapeId]);
    assert.equal(isFullyPlayable(board, shapes), true);
  }
  const savedBudget = BALANCE.generator.solverNodeBudget;
  try {
    BALANCE.generator.solverNodeBudget = 1; // всё «не доказано»
    const tight = crowdedBoard();
    for (let i = 0; i < 50; i++) {
      const pieces = gen(tight, rng, { count: 3 });
      assert.ok(pieces.some((piece) => anyFit(tight, SHAPE_BY_ID[piece.shapeId])));
    }
  } finally {
    BALANCE.generator.solverNodeBudget = savedBudget;
  }
});

// @spec GEN-FAIR-001
test('честный режим: без адаптации и без гарантии', () => {
  const gen = createGenerator();
  const rng = createRng(43);
  const board = crowdedBoard(); // только P1 куда-то влезает
  let noFitIssues = 0;
  for (let i = 0; i < 100; i++) {
    const pieces = gen(board, rng, { count: 3, fairMode: true });
    if (!pieces.some((piece) => anyFit(board, SHAPE_BY_ID[piece.shapeId]))) noFitIssues += 1;
  }
  assert.ok(noFitIssues > 0, 'гарантия в честном режиме должна быть выключена');
  // и никакого сдвига к крупным на пустом поле
  const mean = (fair) => {
    const r = createRng(47);
    let cells = 0;
    for (let i = 0; i < 300; i++) {
      for (const piece of gen(emptyBoard(), r, { count: 3, fairMode: fair })) {
        cells += SHAPE_BY_ID[piece.shapeId].size;
      }
    }
    return cells / 900;
  };
  assert.ok(mean(false) > mean(true) + 0.2);
});

// @spec GEN-DET-001
test('детерминизм: один вход — одна выдача, Math.random не трогается', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Math.random в генераторе запрещён'); };
  try {
    const run = () => {
      const gen = createGenerator();
      const rng = createRng(51);
      const out = [];
      for (let i = 0; i < 30; i++) {
        out.push(gen(i % 2 ? crowdedBoard() : emptyBoard(), rng, { count: 3 }));
      }
      return { out: JSON.stringify(out), state: rng.getState() };
    };
    const a = run();
    const b = run();
    assert.equal(a.out, b.out);
    assert.equal(a.state, b.state);
  } finally {
    Math.random = original;
  }
});

// @spec GEN-BOT-002
test('жадный бот: очистка важнее всего, мобильность важнее затыкания дыр', () => {
  const clearGame = createGame({
    size: 8, seed: 1, headless: true, boosters: { ...FULL_STOCK },
    initialBoard: rowCells(0, range(0, 6)),
    trayProvider: scripted(trioP1()),
  });
  const mv = greedyMove(clearGame);
  assert.deepEqual([mv.x, mv.y], [7, 0]); // единственный очищающий ход

  // дырка 3×3 + изолированные одиночки; очисток нет ниоткуда (каждая линия
  // недосчитывает ≥2 клеток). Ход в дырку убил бы размещаемость SQ3 — бот
  // обязан выбрать одиночку: и мобильность выше, и изолированная пустота гаснет.
  const holes = [
    [0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2],
    [3, 3], [5, 3], [4, 4], [6, 4], [5, 5], [7, 5], [3, 6], [6, 6], [4, 7], [7, 7],
  ];
  const mobilityGame = createGame({
    size: 8, seed: 1, headless: true, boosters: { ...FULL_STOCK },
    initialBoard: allCellsExcept(8, holes),
    trayProvider: scripted([p('P1'), p('P1'), p('P1')]),
  });
  const mv2 = greedyMove(mobilityGame);
  assert.ok(!(mv2.x < 3 && mv2.y < 3), `бот залез в дырку SQ3: ${mv2.x},${mv2.y}`);
});

// @spec GEN-BOT-003
test('автотест: отчёт содержит все обязательные секции', () => {
  const out = execFileSync(process.execPath, ['tools/autotest.js', '5', '3'], { encoding: 'utf8' });
  for (const section of ['несправедливых выдач', 'длина партии', 'очки',
    'перегенераций', 'форсов P1', 'узлов на вызов', 'вердикты']) {
    assert.ok(out.includes(section), section);
  }
});

// @spec GEN-BOT-001
test('дымовой прогон: 30 партий случайного бота без несправедливых выдач', () => {
  const provider = createGenerator();
  for (let seed = 1; seed <= 30; seed++) {
    const game = createGame({ size: 8, seed, headless: true, trayProvider: provider });
    const botRng = createRng(1000 + seed);
    let unfair = false;
    game.on('trayChanged', ({ pieces, placeable }) => {
      if (pieces.filter(Boolean).length === 3 && !placeable.some(Boolean)) unfair = true;
    });
    while (game.phase === 'playing') {
      const mv = randomMove(game, botRng);
      if (!mv) break;
      game.placePiece(mv.slot, mv.x, mv.y);
    }
    assert.equal(unfair, false, `seed ${seed}`);
  }
});

// Главное обещание игроку: выданную тройку можно разыграть целиком — все три
// фигуры ставятся, при необходимости через очистки между постановками.
// Раньше гарантировалась лишь одна размещаемая фигура, и игрок упирался в
// тупик не по своей вине (см. отчёт с поля: SQ3 + S4 + T4 при полном трее).
// @spec GEN-SOLV-003
test('полная разыгрываемость: каждая выдача проходится целиком', () => {
  const gen = createGenerator({ requireFullSolvable: true });
  const rng = createRng(2026);
  const boards = [emptyBoard(), scatteredBoard(), denseBoard(), crowdedBoard()];
  for (const board of boards) {
    for (let i = 0; i < 60; i++) {
      const pieces = gen(board, rng, { count: 3 });
      const shapes = pieces.map((p) => SHAPE_BY_ID[p.shapeId]);
      assert.equal(isFullyPlayable(board, shapes), true,
        `тупиковая выдача ${shapes.map((s) => s.id).join()} при fill=${board.masks.filter(Boolean).length}`);
    }
  }
});

test('партия целиком: ни одной тупиковой выдачи за игру случайного бота', () => {
  const provider = createGenerator({ requireFullSolvable: true });
  let checked = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const game = createGame({ size: 8, seed, headless: true, trayProvider: provider });
    const botRng = createRng(500 + seed);
    const audit = (pieces) => {
      const full = pieces.filter(Boolean);
      if (full.length !== 3) return;
      checked += 1;
      const shapes = full.map((p) => SHAPE_BY_ID[p.shapeId]);
      assert.notEqual(isFullyPlayable(game.board, shapes), false,
        `seed ${seed}: выдачу нельзя разыграть целиком`);
    };
    audit(game.tray);
    game.on('trayChanged', ({ pieces }) => audit(pieces));
    while (game.phase === 'playing') {
      const mv = randomMove(game, botRng);
      if (!mv) break;
      game.placePiece(mv.slot, mv.x, mv.y);
    }
  }
  assert.ok(checked > 50, `проверено выдач: ${checked}`);
});
