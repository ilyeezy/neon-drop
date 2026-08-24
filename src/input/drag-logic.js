// Чистая drag-логика: координаты указателя → позиция отрисовки, клетка-кандидат,
// валидность и линии будущего сгорания. Ни DOM, ни времени — полный цикл тестов.
import { canPlace, fullMask } from '../core/bitboard.js';

export const SNAP_RADIUS = 0.7; // доля клетки, адаптивно от её размера (ТЗ 5.5)

// Позиция отрисовки: фигура центрирована по X на указателе и приподнята
// на liftPx — палец не закрывает место постановки (ТЗ 5.2, главная деталь).
// @spec INPUT-LOG-002
export function dragOriginPx(pointerX, pointerY, shape, cellPx, liftPx) {
  return {
    x: pointerX - (shape.w * cellPx) / 2,
    y: pointerY - liftPx - (shape.h * cellPx) / 2,
  };
}

// Кандидаты по опорной (верхне-левой) клетке — соседние позиции сетки в
// пределах 0.7 клетки по каждой оси. Радиус больше 0.5 — это и есть магнит:
// когда ближайшая позиция занята, фигура прилипает к валидной соседней.
// @spec INPUT-LOG-003, INPUT-LOG-004
export function dragTarget(board, shape, originPx, boardOriginPx, cellPx) {
  const gx = (originPx.x - boardOriginPx.x) / cellPx;
  const gy = (originPx.y - boardOriginPx.y) / cellPx;
  const candidates = [];
  for (const cx of new Set([Math.floor(gx), Math.ceil(gx)])) {
    for (const cy of new Set([Math.floor(gy), Math.ceil(gy)])) {
      const dx = Math.abs(gx - cx);
      const dy = Math.abs(gy - cy);
      // эпсилон: пиксельная арифметика double дрожит на границе радиуса
      if (dx > SNAP_RADIUS + 1e-9 || dy > SNAP_RADIUS + 1e-9) continue;
      if (cx < 0 || cy < 0 || cx + shape.w > board.size || cy + shape.h > board.size) continue;
      candidates.push({ x: cx, y: cy, d: dx * dx + dy * dy, valid: canPlace(board, shape, cx, cy) });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.d - b.d);
  const best = candidates.find((c) => c.valid) ?? candidates[0];
  return { x: best.x, y: best.y, valid: best.valid };
}

// Линии, которые сгорят после постановки: симуляция масками ядра.
// @spec INPUT-LOG-006
export function linesAfterPlace(board, shape, x, y) {
  const masks = board.masks.slice();
  for (let dy = 0; dy < shape.h; dy++) masks[y + dy] |= shape.rows[dy] << x;
  const full = fullMask(board.size);
  const rows = [];
  const cols = [];
  let colAnd = full;
  for (let i = 0; i < board.size; i++) {
    if (masks[i] === full) rows.push(i);
    colAnd &= masks[i];
  }
  for (let c = 0; c < board.size; c++) if ((colAnd >> c) & 1) cols.push(c);
  return { rows, cols };
}

// Полная оценка кадра перетаскивания.
// @spec INPUT-LOG-001, INPUT-LOG-005
export function evaluateDrag(board, shape, pointerX, pointerY, { cellPx, boardOriginPx, liftPx }) {
  const originPx = dragOriginPx(pointerX, pointerY, shape, cellPx, liftPx);
  const target = dragTarget(board, shape, originPx, boardOriginPx, cellPx);
  if (!target) return { originPx, target: null, valid: false, clears: null };
  const clears = target.valid ? linesAfterPlace(board, shape, target.x, target.y) : null;
  return { originPx, target: { x: target.x, y: target.y }, valid: target.valid, clears };
}
