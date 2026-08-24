// Формулы очков (ТЗ п. 3 «Очки»). Весь тракт — в целых числах: очки очистки
// считаются в единицах ×10000 (два множителя по ×100), сумма хода делится и
// теряет дробь ровно один раз в finalizeMovePointsX10000.
import { BALANCE } from './balance.js';

export function placementPoints(shape) {
  return shape.size * BALANCE.pointsPerCell;
}

export function multiBonusX100(n) {
  const list = BALANCE.multiBonusX100;
  return list[Math.min(n, list.length) - 1];
}

export function streakMultX100(step) {
  const list = BALANCE.streakLadderX100;
  return list[Math.min(step, list.length - 1)];
}

// @spec CORE-SCORE-001, CORE-SCORE-004
export function clearPointsX10000(n, size, step) {
  return n * BALANCE.clearBase * size * multiBonusX100(n) * streakMultX100(step);
}

// @spec CORE-SCORE-003
export function emptyBoardBonus(size) {
  return size * BALANCE.emptyBoardBonusPerSize;
}

// значение множителя для отображения (события, HUD)
export function streakMult(step) {
  return streakMultX100(step) / 100;
}

export function finalizeMovePointsX10000(x10000) {
  return (x10000 - (x10000 % 10000)) / 10000;
}
