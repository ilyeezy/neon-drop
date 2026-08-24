// Каталог фигур. Вращения в геймплее нет — каждый поворот записан отдельной
// фигурой (принцип жанра, HLD Non-Goals). Базовые веса — данные для генератора.
// @spec CORE-SHAPE-001, CORE-SHAPE-002

function normalize(cells) {
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells
    .map(([x, y]) => [x - minX, y - minY])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

function rotCW(cells) {
  const h = Math.max(...cells.map((c) => c[1])) + 1;
  return normalize(cells.map(([x, y]) => [h - 1 - y, x]));
}

function makeShape(id, rawCells, weight) {
  const cells = normalize(rawCells);
  const w = Math.max(...cells.map((c) => c[0])) + 1;
  const h = Math.max(...cells.map((c) => c[1])) + 1;
  const rows = new Uint16Array(h);
  for (const [x, y] of cells) rows[y] |= 1 << x;
  const size = cells.length;
  const tier = size <= 2 ? 'small' : size <= 4 ? 'medium' : 'large';
  return Object.freeze({ id, cells, rows, w, h, size, weight, tier });
}

function rect(w, h) {
  const cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push([x, y]);
  return cells;
}

const defs = [];
const add = (id, cells, weight) => defs.push(makeShape(id, cells, weight));

function addRotations(baseId, cells, weight, count) {
  let cur = normalize(cells);
  for (let i = 0; i < count; i++) {
    add(`${baseId}_${i}`, cur, weight);
    cur = rotCW(cur);
  }
}

// Точка
add('P1', [[0, 0]], 6);
// Линии в двух ориентациях
const lineWeights = { 2: 8, 3: 8, 4: 6, 5: 4 };
for (let len = 2; len <= 5; len++) {
  add(`I${len}H`, rect(len, 1), lineWeights[len]);
  add(`I${len}V`, rect(1, len), lineWeights[len]);
}
// Квадраты и прямоугольники
add('SQ2', rect(2, 2), 8);
add('SQ3', rect(3, 3), 3);
add('R23', rect(2, 3), 4);
add('R32', rect(3, 2), 4);
// Малые углы: 3 клетки в габарите 2×2
addRotations('C3', [[0, 0], [1, 0], [0, 1]], 7, 4);
// Большие углы: 5 клеток в габарите 3×3
addRotations('C5', [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]], 4, 4);
// T-формы
addRotations('T4', [[0, 0], [1, 0], [2, 0], [1, 1]], 6, 4);
// S / Z — по две различимые ориентации
addRotations('S4', [[1, 0], [2, 0], [0, 1], [1, 1]], 5, 2);
addRotations('Z4', [[0, 0], [1, 0], [1, 1], [2, 1]], 5, 2);
// J / L — по четыре
addRotations('J4', [[0, 0], [0, 1], [1, 1], [2, 1]], 6, 4);
addRotations('L4', [[2, 0], [0, 1], [1, 1], [2, 1]], 6, 4);

export const SHAPES = Object.freeze(defs);
export const SHAPE_BY_ID = Object.freeze(
  Object.fromEntries(SHAPES.map((s) => [s.id, s])),
);
