// 20 уровней режима задач. Прогрессия спецблоков (ТЗ п. 6): 1–4 без них,
// 5–9 лёд, 10–14 + камень, 15–20 + бомбы, толстый лёд и комбинации.
// Инварианты раскладок (проверяются tests/levels.test.js и верификатором):
// нет дублей клеток, нет изначально полных линий, золото — только на пустых.
// Решаемость подтверждает tools/verify-levels.js двумя прогонами
// (нулевой запас бустеров / максимальный).
const cell = (x, y, extra = {}) => ({ x, y, color: 1 + ((x * 3 + y * 5) % 7), ...extra });
const row = (y, xs, extra = {}) => xs.map((x) => cell(x, y, extra));
const gold = (x, y) => ({ x, y, gold: true });
const ice = (x, y, hp = 1) => cell(x, y, { special: 'ice', hp });
const stone = (x, y) => cell(x, y, { special: 'stone' });
const bomb = (x, y, timer) => cell(x, y, { special: 'bomb', timer });

export const LEVELS = [
  // --- 1–4: базовые механики, без спецблоков ---
  { id: 1, board: [], goal: { type: 'score', x: 250 }, moveLimit: 10, star2Moves: 7 },
  {
    id: 2,
    board: [...row(7, [0, 1, 2, 3, 4, 5]), ...row(5, [2, 3, 4, 5, 6, 7])],
    goal: { type: 'streak', n: 2 }, moveLimit: 14, star2Moves: 9,
  },
  { id: 3, board: [], goal: { type: 'score', x: 480 }, moveLimit: 16, star2Moves: 12 },
  {
    id: 4,
    // дырка 2×2 на стыке двух строк: закрыл — обе линии сгорели, поле чисто
    board: [...row(6, [0, 1, 2, 5, 6, 7]), ...row(7, [0, 1, 2, 5, 6, 7])],
    goal: { type: 'clearBoard' }, moveLimit: 18, star2Moves: 10,
  },

  // --- 5–9: лёд ---
  {
    id: 5,
    board: [ice(2, 5), ice(3, 5), ice(4, 5), ice(5, 5)],
    goal: { type: 'ice' }, moveLimit: 16, star2Moves: 10,
  },
  {
    id: 6,
    board: [...row(4, [0, 1, 6]), ice(2, 4), ice(3, 4), ice(4, 4),
      ...row(6, [0, 6, 7]), ice(3, 6), ice(4, 6), ice(5, 6)],
    goal: { type: 'ice' }, moveLimit: 22, star2Moves: 15,
  },
  {
    id: 7,
    board: [...row(6, [0, 1, 3, 5]), gold(2, 6), gold(4, 6), gold(6, 6)],
    goal: { type: 'gold' }, moveLimit: 16, star2Moves: 10,
  },
  {
    id: 8,
    board: [ice(3, 3), ice(4, 3), ice(3, 4), ice(4, 4)],
    goal: { type: 'score', x: 620 }, moveLimit: 20, star2Moves: 15,
  },
  {
    id: 9,
    board: [...row(7, [0, 1, 2, 3, 6]), ice(4, 7), ice(5, 7), ...row(3, [1, 2, 3, 4, 5, 6])],
    goal: { type: 'streak', n: 3 }, moveLimit: 26, star2Moves: 16,
  },

  // --- 10–14: + камень ---
  {
    id: 10,
    board: [stone(3, 2), stone(3, 3),
      ...row(5, [0, 1]), ice(2, 5), ice(3, 5), ice(4, 5), ice(5, 5),
      ...row(6, [6, 7]), ice(2, 6), ice(3, 6)],
    goal: { type: 'ice' }, moveLimit: 24, star2Moves: 16,
  },
  {
    id: 11,
    board: [stone(1, 6), stone(6, 6), stone(1, 5), stone(6, 5),
      ...row(7, [2, 3, 4, 5]), gold(0, 7), gold(7, 7)],
    goal: { type: 'gold' }, moveLimit: 22, star2Moves: 14,
  },
  {
    id: 12,
    board: [stone(0, 6), stone(7, 6), ...row(6, [1, 2, 5, 6]),
      ...row(7, [0, 1, 2, 5, 6, 7])],
    goal: { type: 'clearBoard' }, moveLimit: 24, star2Moves: 14,
  },
  {
    id: 13,
    board: [stone(2, 2), stone(5, 2), stone(2, 5), stone(5, 5)],
    goal: { type: 'score', x: 600 }, moveLimit: 24, star2Moves: 18,
  },
  {
    id: 14,
    board: [ice(1, 7), ice(2, 7), ...row(7, [0, 3, 4]), gold(5, 7), gold(6, 7),
      ...row(5, [0, 1, 2, 5, 6]), gold(3, 5), gold(4, 5), ice(3, 6), ice(4, 6)],
    goal: { type: 'gold' }, moveLimit: 24, star2Moves: 16,
  },

  // --- 15–20: + бомбы, толстый лёд, комбинации ---
  {
    id: 15,
    board: [...row(1, [0, 2, 3, 6]), bomb(1, 1, 12), bomb(4, 1, 13),
      ...row(2, [0, 1, 6, 7]), bomb(2, 2, 14), bomb(5, 2, 15)],
    goal: { type: 'bombs' }, moveLimit: 20, star2Moves: 12,
  },
  {
    id: 16,
    // толстый лёд: каждая клетка требует двух очисток своей линии
    board: [...row(6, [0, 1, 6]), ice(2, 6, 2), ice(3, 6, 2), ice(4, 6, 2), ice(5, 6, 2)],
    goal: { type: 'ice' }, moveLimit: 26, star2Moves: 18,
  },
  {
    id: 17,
    board: [stone(3, 1), stone(4, 1),
      ...row(2, [0, 1, 7]), bomb(3, 2, 10), bomb(4, 2, 11), bomb(2, 2, 12),
      ...row(3, [0, 1, 6, 7]), bomb(5, 3, 13), bomb(2, 3, 14)],
    goal: { type: 'bombs' }, moveLimit: 24, star2Moves: 15,
  },
  {
    id: 18,
    board: [ice(2, 5, 2), ice(5, 5, 2), ...row(5, [0, 1, 6]),
      ...row(7, [0, 1, 2, 5, 6]), gold(3, 7), gold(4, 7),
      ...row(3, [0, 1, 6, 7]), gold(3, 3), gold(4, 3)],
    goal: { type: 'gold' }, moveLimit: 28, star2Moves: 19,
  },
  {
    id: 19,
    board: [bomb(0, 0, 16), ...row(1, [1, 2, 5, 6]), ice(3, 1), ice(4, 1),
      ...row(6, [0, 1, 2, 6, 7])],
    goal: { type: 'score', x: 700 }, moveLimit: 26, star2Moves: 21,
  },
  {
    id: 20,
    board: [stone(0, 4), stone(7, 4), ...row(4, [1, 2, 5]), bomb(3, 4, 14), bomb(4, 4, 15),
      ...row(6, [0, 1, 6]), ice(2, 6, 2), ice(5, 6, 2), gold(3, 6), gold(4, 6),
      gold(0, 7), gold(7, 7)],
    goal: { type: 'gold' }, moveLimit: 30, star2Moves: 21,
  },
];

export const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
