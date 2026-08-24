// Поле: 16-битные маски строк (бит x строки y, бит 0 — левая колонка) плюс
// плоские массивы цветов и спецблоков. Функции проверки — чистые и без
// аллокаций: их переиспользуют генератор и солвер уровней.
import { SPECIAL, SPECIAL_BY_NAME } from './specials.js';

const SIZES = [8, 9, 10];

// @spec CORE-BOARD-001
export function createBoard(size) {
  if (!SIZES.includes(size)) {
    throw new Error(`bad board size: ${size}`);
  }
  return {
    size,
    masks: new Uint16Array(size),
    colors: new Uint8Array(size * size),
    specials: new Uint8Array(size * size),
    specialData: new Uint8Array(size * size),
    goldMask: new Uint16Array(size),
  };
}

export function fullMask(size) {
  return (1 << size) - 1;
}

export function cellIndex(board, x, y) {
  return y * board.size + x;
}

export function isOccupied(board, x, y) {
  return ((board.masks[y] >> x) & 1) === 1;
}

export function hasGold(board, x, y) {
  return ((board.goldMask[y] >> x) & 1) === 1;
}

// @spec CORE-BOARD-003
export function canPlace(board, shape, x, y) {
  if (x < 0 || y < 0 || x + shape.w > board.size || y + shape.h > board.size) {
    return false;
  }
  for (let dy = 0; dy < shape.h; dy++) {
    if (board.masks[y + dy] & (shape.rows[dy] << x)) return false;
  }
  return true;
}

// @spec CORE-BOARD-004
export function anyFit(board, shape) {
  const maxX = board.size - shape.w;
  const maxY = board.size - shape.h;
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      let ok = true;
      for (let dy = 0; dy < shape.h; dy++) {
        if (board.masks[y + dy] & (shape.rows[dy] << x)) { ok = false; break; }
      }
      if (ok) return true;
    }
  }
  return false;
}

export function occupiedCount(board) {
  let n = 0;
  for (let y = 0; y < board.size; y++) {
    let m = board.masks[y];
    while (m) { m &= m - 1; n++; }
  }
  return n;
}

export function fillRatio(board) {
  return occupiedCount(board) / (board.size * board.size);
}

export function boardIsEmpty(board) {
  return board.masks.every((m) => m === 0);
}

export function cloneBoard(board) {
  return {
    size: board.size,
    masks: board.masks.slice(),
    colors: board.colors.slice(),
    specials: board.specials.slice(),
    specialData: board.specialData.slice(),
    goldMask: board.goldMask.slice(),
  };
}

// @spec CORE-BOARD-002, CORE-SPC-003
export function assertBoardInvariants(board) {
  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      const i = cellIndex(board, x, y);
      const occ = isOccupied(board, x, y);
      if (occ !== (board.colors[i] !== 0)) {
        throw new Error(`invariant: occupancy/color mismatch at ${x},${y}`);
      }
      const sp = board.specials[i];
      if (sp !== SPECIAL.NONE && !occ) {
        throw new Error(`invariant: special on empty cell at ${x},${y}`);
      }
      if (sp === SPECIAL.ICE && ![1, 2].includes(board.specialData[i])) {
        throw new Error(`invariant: ice hp out of range at ${x},${y}`);
      }
      if (sp === SPECIAL.BOMB && board.specialData[i] < 1) {
        throw new Error(`invariant: bomb timer below 1 at ${x},${y}`);
      }
      if (hasGold(board, x, y) && (sp === SPECIAL.ICE || sp === SPECIAL.STONE)) {
        throw new Error(`invariant: gold combined with ice/stone at ${x},${y}`);
      }
    }
  }
}

// Стартовая раскладка уровня: [{x, y, color?, special?, hp?, timer?, gold?}].
// @spec CORE-BOARD-006
export function applyInitialBoard(board, cells) {
  for (const cell of cells) {
    const { x, y } = cell;
    if (x < 0 || y < 0 || x >= board.size || y >= board.size) {
      throw new Error(`initial board: cell out of range ${x},${y}`);
    }
    const i = cellIndex(board, x, y);
    if (cell.gold) {
      // золото допустимо только на полностью пустой клетке раскладки
      if (cell.color !== undefined || cell.special !== undefined) {
        throw new Error(`initial board: gold must sit on an empty cell at ${x},${y}`);
      }
      board.goldMask[y] |= 1 << x;
    }
    if (cell.special !== undefined) {
      const sp = SPECIAL_BY_NAME[cell.special];
      if (sp === undefined) throw new Error(`initial board: unknown special "${cell.special}"`);
      if (cell.color === undefined) {
        throw new Error(`initial board: special without block at ${x},${y}`);
      }
      board.specials[i] = sp;
      if (sp === SPECIAL.ICE) board.specialData[i] = cell.hp ?? 1;
      if (sp === SPECIAL.BOMB) board.specialData[i] = cell.timer ?? 3;
    }
    if (cell.color !== undefined) {
      board.masks[y] |= 1 << x;
      board.colors[i] = cell.color;
    }
  }
  assertBoardInvariants(board);
  return board;
}
