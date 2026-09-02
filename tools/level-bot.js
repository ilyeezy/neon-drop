// Бот, играющий на цель уровня: общий для генератора и верификатора, чтобы
// уровни отбирались и проверялись одной и той же меркой.
import { cloneBoard, cellIndex, occupiedCount, isOccupied, fullMask, hasGold } from '../src/core/bitboard.js';
import { SPECIAL } from '../src/core/specials.js';
import { findFullLines, clearLines } from '../src/core/placement.js';
import { placementPoints, clearPointsX10000, finalizeMovePointsX10000 } from '../src/core/scoring.js';
import { validMoves } from './bots.js';

const BIG = 1000;

// Сколько клеток не хватает до сгорания лучшей линии через (x, y) — градиент,
// без которого метрики целей падали только в момент очистки.
export function lineDeficit(board, x, y) {
  const full = fullMask(board.size);
  let rowMissing = 0;
  let m = (~board.masks[y]) & full;
  while (m) { m &= m - 1; rowMissing += 1; }
  let colMissing = 0;
  for (let i = 0; i < board.size; i++) if (!((board.masks[i] >> x) & 1)) colMissing += 1;
  return Math.min(rowMissing, colMissing);
}

export function boardMetric(board, goal, score) {
  switch (goal.type) {
    case 'score':
      return Math.max(0, goal.x - score);
    case 'gold': {
      let acc = 0;
      for (let y = 0; y < board.size; y++) {
        for (let x = 0; x < board.size; x++) if (hasGold(board, x, y)) acc += BIG + lineDeficit(board, x, y);
      }
      return acc;
    }
    case 'ice': {
      let acc = 0;
      for (let y = 0; y < board.size; y++) {
        for (let x = 0; x < board.size; x++) {
          const i = cellIndex(board, x, y);
          if (board.specials[i] === SPECIAL.ICE) acc += board.specialData[i] * BIG + lineDeficit(board, x, y);
        }
      }
      return acc;
    }
    case 'bombs': {
      let acc = 0;
      for (let y = 0; y < board.size; y++) {
        for (let x = 0; x < board.size; x++) {
          const i = cellIndex(board, x, y);
          if (board.specials[i] === SPECIAL.BOMB) acc += BIG + lineDeficit(board, x, y);
        }
      }
      return acc;
    }
    case 'clearBoard': {
      // вес клетки здесь мал: достройка линии временно увеличивает занятость,
      // и с весом BIG бот никогда бы на это не пошёл
      let acc = 0;
      for (let y = 0; y < board.size; y++) {
        for (let x = 0; x < board.size; x++) if (isOccupied(board, x, y)) acc += 2 + lineDeficit(board, x, y);
      }
      return acc;
    }
    case 'streak': {
      let ready = 0;
      const full = fullMask(board.size);
      for (let y = 0; y < board.size; y++) {
        let missing = 0;
        let m = (~board.masks[y]) & full;
        while (m) { m &= m - 1; missing += 1; }
        if (missing === 1) ready += 3; else if (missing === 2) ready += 1;
      }
      for (let x = 0; x < board.size; x++) {
        let missing = 0;
        for (let i = 0; i < board.size; i++) if (!((board.masks[i] >> x) & 1)) missing += 1;
        if (missing === 1) ready += 3; else if (missing === 2) ready += 1;
      }
      return -ready;
    }
    default:
      return 0;
  }
}

function simulate(game, shape, x, y) {
  const next = cloneBoard(game.board);
  for (const [dx, dy] of shape.cells) {
    next.masks[y + dy] |= 1 << (x + dx);
    next.colors[cellIndex(next, x + dx, y + dy)] = 1;
  }
  const { rows, cols } = findFullLines(next);
  const cleared = rows.length + cols.length;
  if (cleared) clearLines(next, rows, cols);
  let pts = placementPoints(shape) * 10000;
  if (cleared) pts += clearPointsX10000(cleared, next.size, game.streakStep);
  return { next, cleared, gained: finalizeMovePointsX10000(pts) };
}

const cmpKey = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

export function goalBotMove(game, level) {
  const goal = level.goal;
  const before = boardMetric(game.board, goal, game.score);
  let best = null;
  let bestKey = null;
  for (const mv of validMoves(game)) {
    const { next, cleared, gained } = simulate(game, mv.shape, mv.x, mv.y);
    const after = boardMetric(next, goal, game.score + gained);
    // для стрика очистка сейчас важнее задела: ход без очистки обнуляет счётчик
    const key = goal.type === 'streak'
      ? [cleared, before - after, gained, -occupiedCount(next)]
      : [before - after, cleared, gained, -occupiedCount(next)];
    if (!bestKey || cmpKey(key, bestKey) > 0) { best = mv; bestKey = key; }
  }
  return best ? { ...best, gain: bestKey[0], cleared: bestKey[1] } : null;
}
