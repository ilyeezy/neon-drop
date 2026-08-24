// Типы спецблоков режима задач. Золото — не спецблок, а битовая маска
// клеток-целей (goldMask в bitboard.js): оно свойство клетки, живёт под
// поставленным блоком и не занимает слот в specials.
export const SPECIAL = Object.freeze({
  NONE: 0,
  ICE: 1,   // specialData = hp (1|2)
  STONE: 2,
  BOMB: 3,  // specialData = счётчик ходов
});

export const SPECIAL_BY_NAME = Object.freeze({
  ice: SPECIAL.ICE,
  stone: SPECIAL.STONE,
  bomb: SPECIAL.BOMB,
});
