// Верификатор уровней (обязателен для CONTENT): целевой бот играет каждый
// уровень на N сидах двумя прогонами — с нулевым запасом бустеров (уровень
// обязан быть проходим, п. 4.5.2) и с максимальным (не должен схлопываться
// тривиально). Уровень с нулём побед без бустеров в билд не попадает.
// Запуск: node tools/verify-levels.js [seedsPerLevel]
import { createGame } from '../src/core/game.js';
import { createGenerator } from '../src/core/generator.js';
import { LEVELS } from '../src/levels/levels.js';
import { goalDone } from '../src/content/goals.js';
import { validMoves } from './bots.js';
import {
  cloneBoard, cellIndex, occupiedCount, isOccupied, fullMask, hasGold,
} from '../src/core/bitboard.js';
import { SPECIAL } from '../src/core/specials.js';
import { findFullLines, clearLines } from '../src/core/placement.js';
import { placementPoints, clearPointsX10000, finalizeMovePointsX10000 } from '../src/core/scoring.js';

const SEEDS = Number(process.argv[2] ?? 12);
const BIG = 1000; // вес «единицы цели» относительно градиента достройки линий

// Сколько клеток не хватает до сгорания лучшей линии через (x, y).
// Это и есть градиент: без него метрики целей падали только в момент очистки,
// и жадный бот не видел, куда двигаться.
function lineDeficit(board, x, y) {
  const full = fullMask(board.size);
  let rowMissing = 0;
  let m = (~board.masks[y]) & full;
  while (m) { m &= m - 1; rowMissing += 1; }
  let colMissing = 0;
  for (let i = 0; i < board.size; i++) if (!((board.masks[i] >> x) & 1)) colMissing += 1;
  return Math.min(rowMissing, colMissing);
}

// «Остаток цели»: меньше — ближе к победе.
function boardMetric(board, goal, score) {
  switch (goal.type) {
    case 'score':
      return Math.max(0, goal.x - score);
    case 'gold': {
      let acc = 0;
      for (let y = 0; y < board.size; y++) {
        for (let x = 0; x < board.size; x++) {
          if (hasGold(board, x, y)) acc += BIG + lineDeficit(board, x, y);
        }
      }
      return acc;
    }
    case 'ice': {
      let acc = 0;
      for (let y = 0; y < board.size; y++) {
        for (let x = 0; x < board.size; x++) {
          const i = cellIndex(board, x, y);
          if (board.specials[i] === SPECIAL.ICE) {
            acc += board.specialData[i] * BIG + lineDeficit(board, x, y);
          }
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
      // и с весом BIG бот никогда бы не пошёл на это, а без этого поле не очистить
      let acc = 0;
      for (let y = 0; y < board.size; y++) {
        for (let x = 0; x < board.size; x++) {
          if (isOccupied(board, x, y)) acc += 2 + lineDeficit(board, x, y);
        }
      }
      return acc;
    }
    case 'streak': {
      // задел на следующий ход: линии, которым не хватает 1–2 клеток
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
  const board = game.board;
  const next = cloneBoard(board);
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

// лексикографическое сравнение ключей: > 0 если a лучше b
function cmpKey(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function goalBotMove(game, level) {
  const goal = level.goal;
  const before = boardMetric(game.board, goal, game.score);
  let best = null;
  let bestKey = null;
  for (const mv of validMoves(game)) {
    const { next, cleared, gained } = simulate(game, mv.shape, mv.x, mv.y);
    const after = boardMetric(next, goal, game.score + gained);
    // для стрика очистка сейчас важнее задела: пропуск хода без очистки обнуляет счётчик
    const key = goal.type === 'streak'
      ? [cleared, before - after, gained, -occupiedCount(next)]
      : [before - after, cleared, gained, -occupiedCount(next)];
    if (!bestKey || cmpKey(key, bestKey) > 0) {
      best = mv;
      bestKey = key;
    }
  }
  return best ? { ...best, gain: bestKey[0], cleared: bestKey[1] } : null;
}

// Агрессивная стратегия бустеров для прогона «максимальный запас».
function tryBooster(game, level) {
  const b = game.board;
  if (game.boosters.hammer > 0) {
    let target = null;
    let bestDeficit = Infinity;
    for (let y = 0; y < b.size; y++) {
      for (let x = 0; x < b.size; x++) {
        const i = cellIndex(b, x, y);
        const sp = b.specials[i];
        const urgentBomb = sp === SPECIAL.BOMB && b.specialData[i] <= 2;
        const goalCell = (level.goal.type === 'ice' && sp === SPECIAL.ICE)
          || (level.goal.type === 'bombs' && sp === SPECIAL.BOMB)
          || (level.goal.type === 'clearBoard' && isOccupied(b, x, y));
        if (!urgentBomb && !goalCell) continue;
        // молот тратим на то, что дальше всего от сгорания
        const d = urgentBomb ? -1 : -lineDeficit(b, x, y);
        if (d < bestDeficit) { bestDeficit = d; target = { x, y }; }
      }
    }
    if (target) return game.applyBooster('hammer', target).ok;
  }
  if (game.boosters.shuffle > 0) {
    const mv = goalBotMove(game, level);
    if (!mv || (mv.gain <= 0 && mv.cleared === 0)) return game.applyBooster('shuffle').ok;
  }
  return false;
}

function runLevel(level, seed, boosters, useBoosters, provider) {
  const game = createGame({
    size: 8,
    seed,
    headless: true,
    initialBoard: level.board,
    trayProvider: provider,
    boosters,
  });
  const check = () => {
    if (game.phase !== 'playing') return;
    if (goalDone(game, level.goal)) game.end('win', 'goal');
    else if (level.moveLimit && game.moveCount >= level.moveLimit) game.end('loss', 'moves');
  };
  game.on('moveResolved', check);
  game.on('boosterApplied', check);
  game.on('bombExploded', () => game.end('loss', 'bomb'));

  let actions = 0;
  while (game.phase === 'playing' && actions < 400) {
    actions += 1;
    if (useBoosters && tryBooster(game, level)) continue;
    const mv = goalBotMove(game, level);
    if (!mv) break;
    game.placePiece(mv.slot, mv.x, mv.y);
  }
  return { won: game.result?.outcome === 'win', moves: game.moveCount, actions };
}

const median = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)] ?? 0;

let hardFail = false;
console.log(`Верификатор уровней: ${SEEDS} сидов на прогон`);
console.log('lvl | цель        | без бустеров      | с бустерами        | вердикт');
for (const level of LEVELS) {
  const provider = createGenerator({
    requireFullSolvable: true,
    easyDeal: true,
    favor: level.goal.type === 'clearBoard' ? 'space' : 'chains',
  });
  const zero = [];
  const maxed = [];
  for (let s = 1; s <= SEEDS; s++) {
    zero.push(runLevel(level, 1000 + s, { hammer: 0, shuffle: 0, undo: 0 }, false, provider));
    maxed.push(runLevel(level, 1000 + s, { hammer: 9, shuffle: 9, undo: 9 }, true, provider));
  }
  const zw = zero.filter((r) => r.won);
  const mw = maxed.filter((r) => r.won);
  const flags = [];
  if (zw.length === 0) { flags.push('НЕПРОХОДИМ БЕЗ БУСТЕРОВ'); hardFail = true; }
  else if (zw.length / SEEDS < 0.4) flags.push('низкий винрейт');
  if (mw.length === SEEDS && median(mw.map((r) => r.actions)) <= 3) flags.push('тривиален с бустерами');
  console.log(
    `${String(level.id).padStart(3)} | ${level.goal.type.padEnd(11)}`
    + ` | ${String(zw.length).padStart(2)}/${SEEDS}, ходов ${String(median(zw.map((r) => r.moves))).padStart(2)}`
    + `      | ${String(mw.length).padStart(2)}/${SEEDS}, действий ${String(median(mw.map((r) => r.actions))).padStart(2)}`
    + ` | ${flags.join('; ') || 'ок'}`,
  );
}
if (hardFail) {
  console.error('ПРОВАЛ: есть уровни, непроходимые при нулевом запасе бустеров (п. 4.5.2)');
  process.exit(1);
}
