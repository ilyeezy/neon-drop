// Поиск полных линий и одновременная очистка их объединения. Полный список
// линий фиксируется до любого удаления — последовательная очистка при
// пересечениях со льдом давала бы другой результат.
import { cellIndex, fullMask, hasGold } from './bitboard.js';
import { SPECIAL } from './specials.js';

export function findFullLines(board) {
  const full = fullMask(board.size);
  const rows = [];
  const cols = [];
  let colAnd = full;
  for (let y = 0; y < board.size; y++) {
    if (board.masks[y] === full) rows.push(y);
    colAnd &= board.masks[y];
  }
  for (let x = 0; x < board.size; x++) {
    if ((colAnd >> x) & 1) cols.push(x);
  }
  return { rows, cols };
}

// @spec CORE-MOVE-003, CORE-SPC-001, CORE-SPC-002, CORE-SPC-005, CORE-SPC-007
export function clearLines(board, rows, cols) {
  const removedCells = [];
  const iceDamaged = [];
  const defusedBombs = [];
  const goldCleared = [];
  const seen = new Set();

  const clearCell = (x, y) => {
    const key = y * board.size + x;
    if (seen.has(key)) return; // пересечение строки и столбца — один раз
    seen.add(key);
    const i = cellIndex(board, x, y);
    if (hasGold(board, x, y)) {
      board.goldMask[y] &= ~(1 << x);
      goldCleared.push({ x, y });
    }
    if (board.specials[i] === SPECIAL.ICE) {
      const hp = board.specialData[i] - 1;
      if (hp === 0) {
        board.specials[i] = SPECIAL.NONE;
        board.specialData[i] = 0;
      } else {
        board.specialData[i] = hp;
      }
      iceDamaged.push({ x, y, hp }); // бит занятости остаётся
      return;
    }
    if (board.specials[i] === SPECIAL.BOMB) defusedBombs.push({ x, y });
    removedCells.push({ x, y, color: board.colors[i], special: board.specials[i] });
    board.masks[y] &= ~(1 << x);
    board.colors[i] = 0;
    board.specials[i] = SPECIAL.NONE;
    board.specialData[i] = 0;
  };

  for (const y of rows) for (let x = 0; x < board.size; x++) clearCell(x, y);
  for (const x of cols) for (let y = 0; y < board.size; y++) clearCell(x, y);

  return { removedCells, iceDamaged, defusedBombs, goldCleared };
}
