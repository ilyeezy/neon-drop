// Цели уровней — функции состояния ядра, оцениваются в moveResolved и
// boosterApplied (решение LLD CORE: undo не рассинхронизирует прогресс).
// Победа/поражение объявляются командой end; приоритет победы — в ядре.
import { boardIsEmpty } from '../core/bitboard.js';
import { SPECIAL } from '../core/specials.js';
import { t } from '../i18n/index.js';

function countSpecial(board, type) {
  let n = 0;
  for (let i = 0; i < board.specials.length; i++) if (board.specials[i] === type) n += 1;
  return n;
}

function countGold(board) {
  let n = 0;
  for (let y = 0; y < board.size; y++) {
    let m = board.goldMask[y];
    while (m) { m &= m - 1; n += 1; }
  }
  return n;
}

export function goalText(level) {
  const g = level.goal;
  switch (g.type) {
    case 'score': return t('goal_score', { x: g.x, y: level.moveLimit });
    case 'gold': return t('goal_gold');
    case 'ice': return t('goal_ice');
    case 'bombs': return t('goal_bombs');
    case 'clearBoard': return t('goal_clear');
    case 'streak': return t('goal_streak', { n: g.n });
    default: return '';
  }
}

export function goalDone(game, goal) {
  switch (goal.type) {
    case 'score': return game.score >= goal.x;
    case 'gold': return countGold(game.board) === 0;
    case 'ice': return countSpecial(game.board, SPECIAL.ICE) === 0;
    case 'bombs': return countSpecial(game.board, SPECIAL.BOMB) === 0;
    case 'clearBoard': return boardIsEmpty(game.board);
    case 'streak': return game.streakStep >= goal.n;
    default: return false;
  }
}

export function createGoalTracker(game, level, { onUpdate } = {}) {
  let boostersUsed = 0;
  const offs = [];

  const check = () => {
    if (game.phase === 'over') return;
    if (goalDone(game, level.goal)) {
      game.end('win', 'goal');
      return;
    }
    if (level.moveLimit && game.moveCount >= level.moveLimit) {
      game.end('loss', 'moves');
    }
  };

  offs.push(game.on('moveResolved', () => { check(); onUpdate?.(); }));
  offs.push(game.on('boosterApplied', () => { boostersUsed += 1; check(); onUpdate?.(); }));
  offs.push(game.on('undoApplied', () => { boostersUsed += 1; onUpdate?.(); }));
  offs.push(game.on('bombExploded', () => game.end('loss', 'bomb')));

  return {
    get boostersUsed() { return boostersUsed; },
    detach() { offs.forEach((off) => off()); },
  };
}

export function starsFor(level, game, boostersUsed, won) {
  if (!won) return 0;
  let stars = 1;
  if (level.star2Moves && game.moveCount <= level.star2Moves) stars = 2;
  if (boostersUsed === 0 && stars === 2) stars = 3;
  return stars;
}
