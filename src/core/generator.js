// Генератор фигур — ключевой модуль (ТЗ п. 4). Stateless-провайдер для ядра:
// вся память (previous для анти-повтора) приходит через opts, вся случайность —
// через переданный PRNG партии. Геометрия — переиспользование чистых функций
// поля; своей у генератора нет.
import { SHAPES, SHAPE_BY_ID } from './shapes.js';
import { BALANCE } from './balance.js';
import {
  anyFit, canPlace, fillRatio, cloneBoard, cellIndex,
} from './bitboard.js';
import { findFullLines, clearLines } from './placement.js';

const COLOR_COUNT = 7;

// ТЗ 4.3: адаптивные веса по заполненности поля.
// @spec GEN-PICK-002
function shapeWeight(shape, fill) {
  const { low, high } = BALANCE.generatorFill;
  if (fill < low) return shape.weight * shape.size; // ТЗ 4.3: на пустом поле мелочь скучна
  if (fill < high) return shape.weight;             // ТЗ 4.3: базовые веса
  let w = shape.weight / shape.size;                // ТЗ 4.3: игрок задыхается — мельчим
  const isLine = (shape.w === 1 || shape.h === 1) && shape.size >= 3;
  if (isLine) w *= BALANCE.generator.lineBoost;     // линии прорезают завал
  return w;
}

// @spec GEN-PICK-003
function rollIndex(rng, weights, total) {
  const target = rng.next() * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (target < acc) return i;
  }
  return weights.length - 1; // кламп: накопление в double может выйти за границу
}

function pickForms(rng, count, weights, total) {
  const forms = [];
  for (let i = 0; i < count; i++) forms.push(SHAPES[rollIndex(rng, weights, total)]);
  return forms;
}

const sortedIds = (ids) => [...ids].sort();

function sameMultiset(a, b) {
  if (!b || a.length !== b.length) return false;
  const x = sortedIds(a);
  const y = sortedIds(b);
  return x.every((v, i) => v === y[i]);
}

// ТЗ 4.4: анти-паттерны. Best-effort в пределах лимита попыток.
// @spec GEN-ANTI-001, GEN-ANTI-002
function violatesAntiPatterns(forms, previous) {
  if (forms.length !== 3) return false;
  const ids = forms.map((f) => f.id);
  const allSame = ids[0] === ids[1] && ids[1] === ids[2];
  // ТЗ 4.4: не выдавать три одинаковые крупные фигуры
  if (allSame && forms[0].size >= BALANCE.generator.largeSize) return true;
  // ТЗ 4.4: не выдавать три квадрата 3×3
  if (ids.every((id) => id === 'SQ3')) return true;
  // ТЗ 4.4: не повторять одну и ту же тройку два раза подряд
  if (sameMultiset(ids, previous)) return true;
  return false;
}

// ТЗ 4.1: минимум одна фигура выдачи обязана помещаться.
// @spec GEN-GUAR-001
const hasPlaceable = (board, forms) => forms.some((f) => anyFit(board, f));

// @spec GEN-PICK-004, GEN-PICK-005
function withColors(rng, forms) {
  const colors = forms.map(() => 1 + rng.int(COLOR_COUNT));
  if (colors.length === 3 && colors[0] === colors[1] && colors[1] === colors[2]) {
    // три одинаковых цвета выглядят как баг рендера; один перевыбор, результат принимается
    colors[2] = 1 + rng.int(COLOR_COUNT);
  }
  return forms.map((f, i) => ({ shapeId: f.id, color: colors[i] }));
}

// ТЗ 4.2: полная проходимость тройки. DFS с таблицей транспозиций и лимитом
// узлов; три исхода: true (разыгрываема), false (нет), null (не доказано —
// бюджет исчерпан, вызывающий откатывается к обычной гарантии).
// @spec GEN-SOLV-001, GEN-SOLV-002
export function isFullyPlayable(board, shapes, budget = BALANCE.generator.solverNodeBudget, stats = null) {
  const memo = new Map();
  let nodes = 0;
  let exhausted = false;

  const keyOf = (b, remaining) => `${b.masks.join(',')};${b.specials.join(',')};${b.specialData.join(',')}|${remaining.map((s) => s.id).sort().join(',')}`;

  function dfs(b, remaining) {
    if (remaining.length === 0) return true;
    if (nodes >= budget) { exhausted = true; return false; }
    const key = keyOf(b, remaining);
    if (memo.has(key)) return memo.get(key);
    nodes += 1;
    const tried = new Set();
    for (let i = 0; i < remaining.length; i++) {
      const shape = remaining[i];
      if (tried.has(shape.id)) continue; // мультимножество: одинаковые фигуры взаимозаменяемы
      tried.add(shape.id);
      const rest = remaining.filter((_, j) => j !== i);
      const maxX = b.size - shape.w;
      const maxY = b.size - shape.h;
      for (let y = 0; y <= maxY; y++) {
        for (let x = 0; x <= maxX; x++) {
          if (!canPlace(b, shape, x, y)) continue;
          const nb = cloneBoard(b);
          for (const [dx, dy] of shape.cells) {
            nb.masks[y + dy] |= 1 << (x + dx);
            nb.colors[cellIndex(nb, x + dx, y + dy)] = 1;
          }
          const { rows, cols } = findFullLines(nb);
          if (rows.length || cols.length) clearLines(nb, rows, cols);
          if (dfs(nb, rest)) {
            memo.set(key, true);
            return true;
          }
          if (exhausted) return false;
        }
      }
    }
    if (!exhausted) memo.set(key, false); // неполный обход не должен отравлять таблицу
    return false;
  }

  const result = dfs(board, shapes);
  if (stats) {
    stats.solverCalls += 1;
    stats.solverNodes.push(nodes);
  }
  if (!result && exhausted) return null;
  return result;
}

// @spec GEN-PICK-001, GEN-GUAR-002, GEN-GUAR-003, GEN-SOLV-003, GEN-FAIR-001, GEN-DET-001
export function createGenerator(options = {}) {
  const requireFullSolvable = options.requireFullSolvable ?? false;
  const stats = options.collectStats
    ? { issues: 0, regens: 0, forcedP1: 0, solverCalls: 0, solverNodes: [] }
    : null;

  function provider(board, rng, opts) {
    const count = opts.count;
    const previous = opts.previous ?? null;
    if (stats) stats.issues += 1;

    const fill = fillRatio(board);
    const fair = opts.fairMode === true;
    // ТЗ 4.6: честный режим — только базовые веса, без адаптации и гарантий
    const weights = SHAPES.map((s) => (fair ? s.weight : shapeWeight(s, fill)));
    const total = weights.reduce((a, b) => a + b, 0);

    if (fair) return withColors(rng, pickForms(rng, count, weights, total));

    let last = null;
    let guaranteedFallback = null;
    for (let attempt = 0; attempt < BALANCE.generator.maxAttempts; attempt++) {
      const candidate = pickForms(rng, count, weights, total);
      last = candidate;
      if (violatesAntiPatterns(candidate, previous)) {
        if (stats) stats.regens += 1;
        continue;
      }
      if (!hasPlaceable(board, candidate)) {
        if (stats) stats.regens += 1;
        continue;
      }
      if (requireFullSolvable && count === 3) {
        const solvable = isFullyPlayable(board, candidate, BALANCE.generator.solverNodeBudget, stats);
        if (solvable !== true) { // «не доказано» разыгрываемостью не считается
          if (stats) stats.regens += 1;
          guaranteedFallback = guaranteedFallback ?? candidate;
          continue;
        }
      }
      return withColors(rng, candidate);
    }

    // исчерпание лимита: последний кандидат с обычной гарантией, если была;
    // форс P1 — без PRNG на форму, цвета как обычно (ТЗ 4.1)
    const forms = guaranteedFallback ?? last;
    if (!hasPlaceable(board, forms)) {
      forms[count - 1] = SHAPE_BY_ID.P1;
      if (stats) stats.forcedP1 += 1;
    }
    return withColors(rng, forms);
  }

  provider.stats = stats;
  return provider;
}
