// Боты автотеста (ТЗ этап 3). Играют через публичный API ядра и чистые
// функции поля; в архив игры не входят.
import { SHAPES, SHAPE_BY_ID } from '../src/core/shapes.js';
import { anyFit, canPlace, cloneBoard, cellIndex, isOccupied } from '../src/core/bitboard.js';
import { findFullLines, clearLines } from '../src/core/placement.js';

export function validMoves(game) {
  const moves = [];
  for (let slot = 0; slot < 3; slot++) {
    const piece = game.tray[slot];
    if (!piece || !game.placeable[slot]) continue;
    const shape = SHAPE_BY_ID[piece.shapeId];
    for (let y = 0; y <= game.board.size - shape.h; y++) {
      for (let x = 0; x <= game.board.size - shape.w; x++) {
        if (canPlace(game.board, shape, x, y)) moves.push({ slot, x, y, shape });
      }
    }
  }
  return moves;
}

// Случайный бот: равновероятный валидный ход. Доказывает честность генератора.
// @spec GEN-BOT-001
export function randomMove(game, rng) {
  const moves = validMoves(game);
  return moves.length ? moves[rng.int(moves.length)] : null;
}

function simulate(board, shape, x, y) {
  const next = cloneBoard(board);
  for (const [dx, dy] of shape.cells) {
    next.masks[y + dy] |= 1 << (x + dx);
    next.colors[cellIndex(next, x + dx, y + dy)] = 1;
  }
  const { rows, cols } = findFullLines(next);
  const cleared = rows.length + cols.length;
  if (cleared) clearLines(next, rows, cols);
  return { next, cleared };
}

export function mobility(board) {
  let m = 0;
  for (const s of SHAPES) if (anyFit(board, s)) m += 1;
  return m;
}

export function isolatedEmpties(board) {
  const occ = (x, y) => x < 0 || y < 0 || x >= board.size || y >= board.size
    || isOccupied(board, x, y);
  let n = 0;
  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      if (isOccupied(board, x, y)) continue;
      if (occ(x - 1, y) && occ(x + 1, y) && occ(x, y - 1) && occ(x, y + 1)) n += 1;
    }
  }
  return n;
}

// Жадный бот — эвристика играющего человека. Критерии строго по порядку:
// максимум очищенных линий → максимум мобильности (сколько записей каталога
// имеют хотя бы одну валидную позицию — «чтобы было куда ставить») → минимум
// изолированных пустых клеток. Гравитации в жанре нет — «высота» не критерий.
// @spec GEN-BOT-002
export function greedyMove(game) {
  const moves = validMoves(game);
  let best = null;
  let bestKey = null;
  for (const mv of moves) {
    const { next, cleared } = simulate(game.board, mv.shape, mv.x, mv.y);
    const key = [cleared, mobility(next), -isolatedEmpties(next)];
    if (!bestKey
      || key[0] > bestKey[0]
      || (key[0] === bestKey[0] && key[1] > bestKey[1])
      || (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] > bestKey[2])) {
      best = mv;
      bestKey = key;
    }
  }
  return best;
}
