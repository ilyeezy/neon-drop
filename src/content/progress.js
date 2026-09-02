// Итоги партии → сейв: рекорды, статистика, серия дней, звёзды уровней,
// разблокировки тем. Все проверки — по stats, темы открываются и досрочно
// за rewarded (экономика — здесь, показ рекламы — session).
import { THEMES } from '../render/themes.js';
import { dailyDateKey } from './modes.js';

// Ежедневный минимум бустеров. Это добор, а не выдача: избыток, полученный
// за rewarded-видео, не срезается. Без дозаправки реклама оставалась бы
// единственным источником бустеров — прогресс де-факто за просмотры (п. 4.5.2).
export const BOOSTER_DAILY_MIN = { hammer: 3, shuffle: 3, undo: 3 };

// Возвращает true, если сейв изменён и его нужно записать.
export function refillDailyBoosters(save, todayKey) {
  if (save.boostersRefilledOn === todayKey) return false;
  save.boostersRefilledOn = todayKey;
  for (const [type, min] of Object.entries(BOOSTER_DAILY_MIN)) {
    if ((save.boosters[type] ?? 0) < min) save.boosters[type] = min;
  }
  return true; // дату пишем всегда, иначе добор будет пересчитываться каждый запуск
}

export function unlockText(themeDef, tFn) {
  const u = themeDef.unlock;
  switch (u.type) {
    case 'score': return tFn('unlock_score', { n: u.n });
    case 'levels': return tFn('unlock_levels', { n: u.n });
    case 'streak': return tFn('unlock_streak', { n: u.n });
    case 'clear': return tFn('unlock_clear');
    default: return '';
  }
}

export function checkThemeUnlocks(save) {
  const unlocked = [];
  for (const theme of THEMES) {
    if (save.progress.themes.includes(theme.id)) continue;
    const u = theme.unlock;
    const s = save.stats;
    const ok = (u.type === 'score' && s.bestScore >= u.n)
      || (u.type === 'levels' && s.levelsDone >= u.n)
      || (u.type === 'streak' && s.maxStreak >= u.n)
      || (u.type === 'clear' && s.boardsCleared > 0);
    if (ok) {
      save.progress.themes.push(theme.id);
      unlocked.push(theme.id);
    }
  }
  return unlocked;
}

// Вызывается на gameOver. Возвращает данные для экрана результата.
export function applyResult(save, party, game, { stars = 0, maxStreakInRun = 0, boardCleared = false } = {}) {
  const out = { newRecord: false, unlocked: [], stars };
  save.stats.bestScore = Math.max(save.stats.bestScore, game.score);
  save.stats.maxStreak = Math.max(save.stats.maxStreak, maxStreakInRun);
  if (boardCleared) save.stats.boardsCleared += 1;

  if (party.recordKey && party.scored) {
    if (game.score > save.records[party.recordKey]) {
      save.records[party.recordKey] = game.score;
      out.newRecord = true;
    }
  }

  if (party.level && stars > 0) {
    const idx = party.level.id - 1;
    const prev = save.progress.levels[idx] ?? 0;
    while (save.progress.levels.length <= idx) save.progress.levels.push(0);
    if (stars > prev) save.progress.levels[idx] = stars;
    save.stats.levelsDone = save.progress.levels.filter((s) => s > 0).length;
  }

  // остаток бустеров партии возвращается в общий пул (ТЗ: запас общий)
  save.boosters = { ...game.boosters };

  out.unlocked = checkThemeUnlocks(save);
  return out;
}

export function isLevelOpen(save, levelId) {
  if (levelId === 1) return true;
  return (save.progress.levels[levelId - 2] ?? 0) > 0;
}
