import { createGame } from '../src/core/game.js';
import { SHAPES } from '../src/core/shapes.js';

export const p = (shapeId, color = 1) => ({ shapeId, color });

export const trioP1 = () => [p('P1'), p('P1'), p('P1')];

// Провайдер по сценарию: выдаёт наборы по очереди (обрезая до запрошенного
// count), последний — по кругу.
export function scripted(...triples) {
  let i = 0;
  return (board, rng, opts = {}) => triples[Math.min(i++, triples.length - 1)]
    .slice(0, opts.count ?? 3)
    .map((x) => ({ ...x }));
}

// Провайдер, потребляющий PRNG партии (для тестов детерминизма).
export function randomProvider(board, rng, opts = {}) {
  return Array.from({ length: opts.count ?? 3 }, () => ({
    shapeId: SHAPES[rng.int(SHAPES.length)].id,
    color: 1 + rng.int(7),
  }));
}

export const FULL_STOCK = { hammer: 99, shuffle: 99, undo: 99 };

export function baseGame(over = {}) {
  return createGame({
    size: 8,
    seed: 42,
    headless: true,
    trayProvider: scripted(trioP1()),
    boosters: { ...FULL_STOCK },
    ...over,
  });
}

export const rowCells = (y, xs, color = 1) => xs.map((x) => ({ x, y, color }));

export const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export function allCellsExcept(size, empties) {
  const skip = new Set(empties.map(([x, y]) => y * size + x));
  const cells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!skip.has(y * size + x)) cells.push({ x, y, color: 1 });
    }
  }
  return cells;
}

// Поле «почти забито» изолированными дырками: постановка P1 в (3,3) ничего не
// сжигает, после неё SQ3 некуда ставить → честный no-fit.
export const NO_FIT_EMPTIES = [
  [0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [5, 3], [3, 6],
];

export function noFitGame(over = {}) {
  return baseGame({
    initialBoard: allCellsExcept(8, NO_FIT_EMPTIES),
    trayProvider: scripted([p('P1'), p('SQ3'), p('SQ3')]),
    ...over,
  });
}

export function capture(game, names) {
  const log = [];
  for (const n of names) game.on(n, (payload) => log.push({ n, payload }));
  return log;
}

// Детерминированный бот: первая размещаемая фигура в первую валидную позицию.
export function firstFit(game) {
  for (let slot = 0; slot < 3; slot++) {
    if (!game.tray[slot] || !game.placeable[slot]) continue;
    for (let y = 0; y < game.board.size; y++) {
      for (let x = 0; x < game.board.size; x++) {
        if (game.canPlacePiece(slot, x, y)) {
          return { slot, x, y, res: game.placePiece(slot, x, y) };
        }
      }
    }
  }
  return null;
}

// Состояние партии без запаса бустеров: расход не откатывается отменой
// (CORE-BST-010), поэтому сравнения «до/после undo» идут по этой проекции.
export function comparable(saved) {
  const { boosters, ...rest } = saved;
  return rest;
}
