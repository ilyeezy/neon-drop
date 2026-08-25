// Конфигурации режимов: что уходит в createGame и что значит партия для
// сейва. Сид классики — от времени запуска партии (это выбор сида, не
// игровая случайность); сид ежедневного — локальная дата.
import { createGenerator } from '../core/generator.js';
import { LEVEL_BY_ID } from '../levels/levels.js';

export const BIG_UNLOCK_SCORE = 30000;

export function dailySeed(date = new Date()) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

export function dailyDateKey(date = new Date()) {
  return String(dailySeed(date));
}

let runCounter = 0;

export function buildParty(modeId, { save, levelId } = {}) {
  runCounter += 1;
  const fair = save.settings.fairMode;
  const base = {
    headless: false,
    boosters: { ...save.boosters },
    boosterCostsMove: false,
    boosterTicksBombs: false,
  };
  if (modeId === 'classic' || modeId === 'big') {
    const isBig = modeId === 'big';
    return {
      modeId,
      config: {
        ...base,
        size: isBig ? 10 : 8,
        seed: ((Date.now() + runCounter * 7919) >>> 0) || 1,
        fairMode: fair,
        // тройка обязана быть разыгрываемой целиком (с учётом очисток между
        // постановками); в честном режиме гарантий нет по определению
        trayProvider: createGenerator({ requireFullSolvable: !fair }),
      },
      recordKey: fair ? (isBig ? 'fairBig' : 'fairClassic') : (isBig ? 'big' : 'classic'),
      level: null,
      scored: true,
    };
  }
  if (modeId === 'daily') {
    const today = dailyDateKey();
    const alreadyPlayed = save.daily.lastDate === today && save.daily.playedToday;
    const scored = !alreadyPlayed || (!save.daily.secondAttemptUsed && save.daily.rvSecond === true);
    return {
      modeId,
      config: {
        ...base,
        size: 8,
        seed: dailySeed(),
        fairMode: false, // гарантия в ежедневном не отключается (HLD)
        trayProvider: createGenerator({ requireFullSolvable: true }),
      },
      recordKey: null,
      level: null,
      scored,
      dateKey: today,
    };
  }
  if (modeId === 'levels') {
    const level = LEVEL_BY_ID[levelId];
    return {
      modeId,
      config: {
        ...base,
        size: 8,
        seed: ((Date.now() + runCounter * 104729) >>> 0) || 1,
        fairMode: false,
        initialBoard: level.board,
        trayProvider: createGenerator({ requireFullSolvable: true }),
      },
      recordKey: null,
      level,
      scored: false,
    };
  }
  throw new Error(`unknown mode: ${modeId}`);
}
