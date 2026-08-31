// Цели уровней — функции состояния ядра, оцениваются в moveResolved и
// boosterApplied (решение LLD CORE: undo не рассинхронизирует прогресс).
// Победа/поражение объявляются командой end; приоритет победы — в ядре.
import { boardIsEmpty, occupiedCount } from '../core/bitboard.js';
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

// Прогресс цели шкалами вместо строки текста: игрок видит, сколько осталось,
// не вчитываясь в условие. Возвращает 1–2 полосы: сама цель и лимит ходов.
export function goalBars(game, level) {
  const g = level.goal;
  const bars = [];
  switch (g.type) {
    case 'score':
      bars.push({ key: 'bar_score', value: Math.min(game.score, g.x), max: g.x, kind: 'goal' });
      break;
    case 'gold':
      bars.push({ key: 'bar_gold', value: (level.goldTotal ?? countGold(game.board)), max: level.goldTotal ?? 1, kind: 'goal', countdown: countGold(game.board) });
      break;
    case 'ice':
      bars.push({ key: 'bar_ice', value: 0, max: level.iceTotal ?? 1, kind: 'goal', countdown: countSpecial(game.board, SPECIAL.ICE) });
      break;
    case 'bombs':
      bars.push({ key: 'bar_bombs', value: 0, max: level.bombTotal ?? 1, kind: 'goal', countdown: countSpecial(game.board, SPECIAL.BOMB) });
      break;
    case 'clearBoard':
      bars.push({ key: 'bar_clear', value: 0, max: level.cellsTotal ?? 1, kind: 'goal', countdown: occupiedCount(game.board) });
      break;
    case 'streak':
      bars.push({ key: 'bar_streak', value: Math.min(game.streakStep, g.n), max: g.n, kind: 'goal' });
      break;
    default:
      break;
  }
  // цели-«убери всё» считаются от остатка: заполнение шкалы = приближение к нулю
  for (const bar of bars) {
    if (bar.countdown !== undefined) {
      bar.value = Math.max(0, bar.max - bar.countdown);
      bar.text = `${bar.countdown}`;
    } else {
      bar.text = `${bar.value} / ${bar.max}`;
    }
  }
  if (level.moveLimit) {
    const used = Math.min(game.moveCount, level.moveLimit);
    bars.push({
      key: 'bar_moves',
      value: level.moveLimit - used,
      max: level.moveLimit,
      kind: 'moves',
      text: `${level.moveLimit - used}`,
    });
  }
  return bars;
}

// Сколько целевых объектов было на старте — знаменатель шкал.
export function levelTotals(level) {
  const board = level.board ?? [];
  return {
    goldTotal: board.filter((c) => c.gold).length,
    iceTotal: board.filter((c) => c.special === 'ice').reduce((n, c) => n + (c.hp ?? 1), 0),
    bombTotal: board.filter((c) => c.special === 'bomb').length,
    cellsTotal: board.filter((c) => c.color !== undefined).length,
  };
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
