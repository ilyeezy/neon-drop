// Конфигурации режимов: что уходит в createGame и что значит партия для
// сейва. Сид классики — от времени запуска партии (это выбор сида, не
// игровая случайность); сид ежедневного — локальная дата.
import { createGenerator } from '../core/generator.js';
import { LEVEL_BY_ID } from '../levels/levels.js';

export const BIG_UNLOCK_SCORE = 30000;

// ключ дня нужен ежедневной дозаправке бустеров
export function dailySeed(date = new Date()) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

export function dailyDateKey(date = new Date()) {
  return String(dailySeed(date));
}

let runCounter = 0;

export function buildParty(modeId, { save, levelId } = {}) {
  runCounter += 1;
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
        fairMode: false,
        // тройка обязана быть разыгрываемой целиком (с учётом очисток между
        // постановками) — способ раздачи игроку не показывается и не настраивается
        trayProvider: createGenerator({
          requireFullSolvable: true,
          easyDeal: true,
          bulky: true,
        }),
      },
      recordKey: isBig ? 'big' : 'classic',
      level: null,
      scored: true,
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
        // помощь работает и в задачах: цель уровня — головоломка, а не борьба
        // с выдачей. Под цель «очистить поле» выдача подстраивается отдельно —
        // там ценен пустой остаток, а не длинная серия сгораний.
        trayProvider: createGenerator({
          requireFullSolvable: true,
          easyDeal: true,
          favor: level.goal.type === 'clearBoard' ? 'space' : 'chains',
          // в задачах мелочь — инструмент: ею добивают линию через нужную
          // клетку. В счётных режимах она скучна и режется (GEN-HELP-004)
          smallFloor: 1,
        }),
      },
      recordKey: null,
      level,
      scored: false,
    };
  }
  throw new Error(`unknown mode: ${modeId}`);
}
