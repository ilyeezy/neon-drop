// Генератор фигур — ключевой модуль (ТЗ п. 4). Stateless-провайдер для ядра:
// вся память (previous для анти-повтора) приходит через opts, вся случайность —
// через переданный PRNG партии. Геометрия — переиспользование чистых функций
// поля; своей у генератора нет.
import { SHAPES, SHAPE_BY_ID } from './shapes.js';
import { BALANCE } from './balance.js';
import {
  anyFit, canPlace, fillRatio, cloneBoard, cellIndex, fullMask, occupiedCount,
} from './bitboard.js';
import { findFullLines, clearLines } from './placement.js';

const COLOR_COUNT = 7;

// ТЗ 4.3: адаптивные веса по заполненности поля.
// @spec GEN-PICK-002
export function shapeWeight(shape, fill, bulky = false) {
  const { low, high } = BALANCE.generatorFill;
  if (fill < low) return shape.weight * shape.size; // ТЗ 4.3: на пустом поле мелочь скучна
  // ТЗ 4.3: базовые веса. В счётных режимах — с наклоном к крупным: на
  // полупустом поле мелкая фигура тратит ход, а места ещё вдоволь. В задачах
  // наклон не нужен, там цель точечная и крупные мешают (замер: уровень 68
  // проседал с 54% до 38%).
  if (fill < high) return shape.weight * (bulky ? Math.sqrt(shape.size) : 1);
  // ТЗ 4.3: игрок задыхается — мельчим. Давление на крупные растёт с теснотой,
  // мелочь и линии наоборот поддерживаются: раздача должна выручать, а не добивать.
  const { tightPenalty, smallBoost, lineBoost } = BALANCE.generator;
  let w = shape.weight / (shape.size ** tightPenalty);
  if (shape.size <= 2) w *= smallBoost;
  const isLine = (shape.w === 1 || shape.h === 1) && shape.size >= 3;
  if (isLine) w *= lineBoost;                       // линии прорезают завал
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

// `mercy` (если передан) действует ровно на первый слот — остальные слоты
// разыгрываются обычными весами: жалость сглаживает полосу невезения, а не
// перекраивает всю раздачу.
function pickForms(rng, count, weights, total, mercy = null) {
  const forms = [];
  for (let i = 0; i < count; i++) {
    const useMercy = mercy && i === 0;
    const w = useMercy ? mercy.weights : weights;
    const t = useMercy ? mercy.total : total;
    forms.push(SHAPES[rollIndex(rng, w, t)]);
  }
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

// Сколько валидных позиций у фигуры — мера того, насколько её легко пристроить.
function placementCount(board, shape) {
  let n = 0;
  for (let y = 0; y <= board.size - shape.h; y++) {
    for (let x = 0; x <= board.size - shape.w; x++) {
      if (canPlace(board, shape, x, y)) n += 1;
    }
  }
  return n;
}

// «Удобство» набора: суммарная свобода размещения. Подкрутка весов на длину
// партии почти не влияла (замер: разброс в пределах шума), а выбор лучшего из
// нескольких разыгрываемых кандидатов влияет напрямую.
const dealComfort = (board, forms) => forms.reduce((sum, f) => sum + placementCount(board, f), 0);

// лексикографическое сравнение ключей: > 0 если a лучше b
function cmpKey(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// Сколько линий сгорит, если поставить фигуру сюда. Без клонирования доски:
// проверка гоняется по всем позициям всех фигур каталога, аллокации тут дороги.
const scratch = new Uint16Array(16);
function clearsAt(board, shape, x, y) {
  const n = board.size;
  const full = fullMask(n);
  for (let i = 0; i < n; i++) scratch[i] = board.masks[i];
  for (let dy = 0; dy < shape.h; dy++) scratch[y + dy] |= shape.rows[dy] << x;
  let cleared = 0;
  let colAnd = full;
  for (let i = 0; i < n; i++) {
    if (scratch[i] === full) cleared += 1;
    colAnd &= scratch[i];
  }
  while (colAnd) { colAnd &= colAnd - 1; cleared += 1; }
  return cleared;
}

// Лучшее, что фигура может сделать на этом поле: 0 — сжечь нечем.
export function bestClear(board, shape) {
  let best = 0;
  for (let y = 0; y <= board.size - shape.h; y++) {
    for (let x = 0; x <= board.size - shape.w; x++) {
      if (!canPlace(board, shape, x, y)) continue;
      const c = clearsAt(board, shape, x, y);
      if (c > best) best = c;
    }
  }
  return best;
}

// Насколько ход «на ладони»: среди сжигающих позиций берём ту, где фигура
// плотнее всего вписана в рельеф, и делим прилегание на число клеток. Игрок
// не перебирает варианты — он видит нишу, в которую форма садится как пазл;
// сжигающий ход в открытом поле для него всё равно что его нет.
export function obviousClear(board, shape) {
  measureFree(board);
  let best = -Infinity;
  for (let y = 0; y <= board.size - shape.h; y++) {
    for (let x = 0; x <= board.size - shape.w; x++) {
      if (!canPlace(board, shape, x, y)) continue;
      if (clearsAt(board, shape, x, y) === 0) continue;
      const v = fitAt(board, shape, x, y) / shape.size;
      if (v > best) best = v;
    }
  }
  return best;
}

// «Ключи к замку»: фигуры каталога, которыми прямо сейчас можно сжечь линию.
// Это сердце помощи игроку — видеть почти собранный ряд и не получать под него
// фигуру обиднее всего, а именно это и происходило, когда выдача смотрела
// только на свободу размещения.
function findKeys(board) {
  let keys = [];
  let best = 0;
  const scored = [];
  for (const shape of SHAPES) {
    const c = bestClear(board, shape);
    if (c === 0) continue;
    if (c > best) { best = c; scored.length = 0; }
    if (c === best) scored.push(shape);
  }
  if (!scored.length) return { keys, best };
  // Среди равных по числу линий оставляем те, чей сжигающий ход виднее всего:
  // форма садится в нишу, а не вписывается в открытое поле хитрым образом.
  let clearest = -Infinity;
  for (const shape of scored) {
    const v = obviousClear(board, shape);
    if (v > clearest) { clearest = v; keys = [shape]; } else if (v === clearest) keys.push(shape);
  }
  return { keys, best };
}

// Потенциал набора: жадно разыгрываем всю тройку и считаем, сколько ходов
// подряд ею удаётся сжечь линию и сколько линий выходит всего.
// Мерить максимум по одной фигуре нельзя: набор «одна мощная + две лишние»
// даёт одну вспышку и обрывает серию, а игрок ждёт продолжения (замер на
// уровнях-сериях: 0 побед из 8 против 3 из 8 у прежней выдачи).
// Насколько аккуратно фигура ложится в рельеф, когда сжечь нечем: считаем
// прилегание к занятым клеткам и краю, приближение строк и столбцов к
// заполнению и штраф за новые дырки-одиночки. Без этой оценки выдача в
// спокойный момент выбиралась вслепую — все кандидаты равны по сгораниям.
// Счётчики свободных клеток по строкам и столбцам — считаются один раз на
// доску, иначе внутренний цикл по столбцам съедал больше половины времени.
const rowFree = new Uint8Array(16);
const colFree = new Uint8Array(16);
function measureFree(board) {
  const n = board.size;
  const full = fullMask(n);
  colFree.fill(0, 0, n);
  for (let y = 0; y < n; y++) {
    let free = 0;
    let m = (~board.masks[y]) & full;
    while (m) { m &= m - 1; free += 1; }
    rowFree[y] = free;
    for (let x = 0; x < n; x++) if (!((board.masks[y] >> x) & 1)) colFree[x] += 1;
  }
}

function fitAt(board, shape, x, y) {
  const n = board.size;
  const occupied = (cx, cy) => {
    if (cx < 0 || cx >= n || cy < 0 || cy >= n) return true;
    if ((board.masks[cy] >> cx) & 1) return true;
    const dy = cy - y;
    if (dy < 0 || dy >= shape.h) return false;
    return ((shape.rows[dy] >> (cx - x)) & 1) === 1;
  };

  let contact = 0;
  for (const [dx, dy] of shape.cells) {
    const cx = x + dx;
    const cy = y + dy;
    if (occupied(cx - 1, cy)) contact += 1;
    if (occupied(cx + 1, cy)) contact += 1;
    if (occupied(cx, cy - 1)) contact += 1;
    if (occupied(cx, cy + 1)) contact += 1;
  }

  // новые дырки-одиночки ищем только вокруг фигуры: дальше поле не менялось
  let holes = 0;
  for (const [dx, dy] of shape.cells) {
    for (const [ox, oy] of NEIGHBOURS) {
      const cx = x + dx + ox;
      const cy = y + dy + oy;
      if (occupied(cx, cy)) continue;
      if (occupied(cx - 1, cy) && occupied(cx + 1, cy)
        && occupied(cx, cy - 1) && occupied(cx, cy + 1)) holes += 1;
    }
  }

  // строки и столбцы, которым осталось 1–2 клетки, — задел на следующий ход
  let near = 0;
  for (let dy = 0; dy < shape.h; dy++) {
    let added = 0;
    let m = shape.rows[dy];
    while (m) { m &= m - 1; added += 1; }
    const missing = rowFree[y + dy] - added;
    if (missing >= 1 && missing <= 2) near += 1;
  }
  for (let dx = 0; dx < shape.w; dx++) {
    let added = 0;
    for (let dy = 0; dy < shape.h; dy++) if ((shape.rows[dy] >> dx) & 1) added += 1;
    const missing = colFree[x + dx] - added;
    if (missing >= 1 && missing <= 2) near += 1;
  }
  return contact + near * 3 - holes * 3;
}

const NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function dealChain(board, forms) {
  let work = board;
  const rest = forms.slice();
  let chains = 0;
  let total = 0;
  let fit = 0;
  let immediate = 0;
  for (let step = 0; step < forms.length; step++) {
    let pick = null;
    let bestClears = 0;
    let bestFit = -Infinity;
    measureFree(work);
    for (let i = 0; i < rest.length; i++) {
      const shape = rest[i];
      for (let y = 0; y <= work.size - shape.h; y++) {
        for (let x = 0; x <= work.size - shape.w; x++) {
          if (!canPlace(work, shape, x, y)) continue;
          const c = clearsAt(work, shape, x, y);
          // сгорание важнее любой укладки; при равенстве — кто лучше лёг
          if (c < bestClears) continue;
          const f = c > 0 ? 0 : fitAt(work, shape, x, y);
          if (c > bestClears || f > bestFit) {
            bestClears = c;
            bestFit = f;
            pick = { i, shape, x, y };
          }
        }
      }
    }
    if (!pick) break;
    if (bestClears > 0) {
      chains += 1;
      total += bestClears;
      // сгорание прямо сейчас ценнее отложенного: игрок видит поле сегодня
      if (step === 0) immediate = 1;
    } else {
      fit += bestFit;
    }
    work = cloneBoard(work);
    for (const [dx, dy] of pick.shape.cells) {
      work.masks[pick.y + dy] |= 1 << (pick.x + dx);
      work.colors[cellIndex(work, pick.x + dx, pick.y + dy)] = 1;
    }
    const { rows, cols } = findFullLines(work);
    if (rows.length || cols.length) clearLines(work, rows, cols);
    rest.splice(pick.i, 1);
  }
  return { immediate, chains, total, fit, left: occupiedCount(work) };
}

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

// Мелочь (1–2 клетки) полезна не всегда: на просторном поле она скучна и
// тратит ход впустую. Нужной она становится в тесноте и когда на поле есть
// замкнутая полость в одну-две клетки: фигура из трёх клеток туда не входит
// ни одной стороной, и без мелочи такая яма остаётся на поле навсегда.
function needsSmall(board, fill) {
  if (fill >= BALANCE.generatorFill.high) return true;
  // Пока на поле просторно, карман в одну-две клетки мелочи не стоит: место
  // есть везде, а мелкая фигура тратит ход впустую. Закроется позже, когда
  // поле уплотнится и мелочь снова станет уместной.
  if (fill < BALANCE.generator.smallFillGate) return false;
  const n = board.size;
  const seen = new Uint8Array(n * n);
  const stack = [];
  for (let y0 = 0; y0 < n; y0++) {
    for (let x0 = 0; x0 < n; x0++) {
      if (seen[y0 * n + x0] || ((board.masks[y0] >> x0) & 1)) continue;
      // обходим связную область пустых клеток и меряем её размер
      // область обходим целиком: прерваться на середине нельзя — непомеченный
      // хвост той же области сойдёт за отдельный маленький карман
      let size = 0;
      stack.length = 0;
      stack.push(x0, y0);
      seen[y0 * n + x0] = 1;
      while (stack.length) {
        const y = stack.pop();
        const x = stack.pop();
        size += 1;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
          if (seen[ny * n + nx] || ((board.masks[ny] >> nx) & 1)) continue;
          seen[ny * n + nx] = 1;
          stack.push(nx, ny);
        }
      }
      if (size <= 2) return true;
    }
  }
  return false;
}

// Сколько мелочи допустимо в одной тройке при текущем состоянии поля.
// `floor` поднимает нижнюю границу для режимов, где мелочь — рабочий
// инструмент: в задачах ею добивают линию через нужную клетку (золото, лёд,
// бомба), и запрет ронял проходимость.
function smallAllowance(board, fill, floor) {
  if (fill >= BALANCE.generatorFill.high) return 2;
  return Math.max(floor, needsSmall(board, fill) ? 1 : 0);
}

const smallCount = (forms) => forms.reduce((n, f) => n + (f.size <= 2 ? 1 : 0), 0);

// Фигуры каталога, которые лучше всего ложатся в текущий рельеф: заполняют
// выемку, прижимаются к занятым клеткам, не оставляют дырок. Игрок, вырывший
// место под конкретную форму, ждёт именно её, и не получить её — обиднее
// всего; отбора среди случайных кандидатов для этого мало, форма может просто
// не выпасть.
function findFitters(board, allowance) {
  let best = -Infinity;
  const pool = [];
  measureFree(board); // fitAt читает счётчики свободных клеток по строкам и столбцам
  for (const shape of SHAPES) {
    if (shape.size <= 2 && allowance <= 0) continue;
    let f = -Infinity;
    for (let y = 0; y <= board.size - shape.h; y++) {
      for (let x = 0; x <= board.size - shape.w; x++) {
        if (!canPlace(board, shape, x, y)) continue;
        const v = fitAt(board, shape, x, y);
        if (v > f) f = v;
      }
    }
    if (f === -Infinity) continue;
    // нормируем на размер: прилегание суммируется по клеткам, и без нормировки
    // «лучше всех ложится» всегда оказывался самый большой квадрат — он забивал
    // поле, и сгорания за партию падали вчетверо
    const score = f / shape.size;
    if (score > best) { best = score; pool.length = 0; }
    if (score === best) pool.push(shape);
  }
  return pool;
}

// Замена самой бесполезной фигуры набора на подсказанную: сначала смотрим,
// сколько линий фигура сжигает, и лишь при равенстве — сколько у неё мест.
// Иначе подстановка выкидывала как раз ту, которой можно было сжечь.
function swapWorst(board, forms, replacement, keep) {
  const out = [...forms];
  let worst = -1;
  let worstClear = Infinity;
  let worstCount = Infinity;
  out.forEach((f, i) => {
    if (i === keep) return;
    const cleared = bestClear(board, f);
    if (cleared > worstClear) return;
    const count = placementCount(board, f);
    if (cleared < worstClear || count < worstCount) {
      worstClear = cleared;
      worstCount = count;
      worst = i;
    }
  });
  if (worst < 0) return { forms, index: keep };
  out[worst] = replacement;
  return { forms: out, index: worst };
}

// Помощь поверх отбора: если сжечь набором нельзя, подкладываем либо фигуру,
// которой линия сгорит прямо сейчас, либо — когда сжигать нечего — ту, что
// лучше всех ложится в рельеф.
// `fitters` включает подгонку под рельеф — она уместна там, где цель партии
// сам рельеф. В задачах цель точечная (лёд, бомба, золото под конкретной
// клеткой), и подгонка уводит от неё: проходимость трёх уровней просела.
// Связные области пустоты не крупнее предела — те самые «ниши», которые
// игрок видит формой, а не подсчётом клеток до полной линии.
function findPockets(board, limit) {
  const n = board.size;
  const seen = new Uint8Array(n * n);
  const out = [];
  for (let y0 = 0; y0 < n; y0++) {
    for (let x0 = 0; x0 < n; x0++) {
      if (seen[y0 * n + x0] || ((board.masks[y0] >> x0) & 1)) continue;
      const cells = [];
      const stack = [x0, y0];
      seen[y0 * n + x0] = 1;
      while (stack.length) {
        const y = stack.pop();
        const x = stack.pop();
        cells.push([x, y]);
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
          if (seen[ny * n + nx] || ((board.masks[ny] >> nx) & 1)) continue;
          seen[ny * n + nx] = 1;
          stack.push(nx, ny);
        }
      }
      if (cells.length <= limit) out.push(cells);
    }
  }
  return out;
}

// Форма садится в нишу целиком, клетка в клетку.
function fillsPocket(shape, cells) {
  if (shape.size !== cells.length) return false;
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  return shape.cells.every(([dx, dy]) => cells
    .some(([x, y]) => x - minX === dx && y - minY === dy));
}

// Формы, которые ложатся в какую-нибудь нишу как пазл. Это и есть ход
// «на ладони»: игрок видит нишу и ждёт ровно её форму, а не выискивает,
// куда пристроить фигуру ради сгорания.
// @spec GEN-HELP-006
function findPocketShapes(board, allowance) {
  const pockets = findPockets(board, BALANCE.generator.pocketLimit);
  if (!pockets.length) return [];
  const out = [];
  for (const shape of SHAPES) {
    if (shape.size <= 2 && allowance <= 0) continue;
    if (pockets.some((cells) => fillsPocket(shape, cells))) out.push(shape);
  }
  return out;
}

// Сначала форма ровно под нишу, и лишь если ниш нет — просто лучшая укладка.
function pocketOrFit(board, allowance) {
  const pocket = findPocketShapes(board, allowance);
  return pocket.length ? pocket : findFitters(board, allowance);
}

function withHelp(board, rng, best, allowance, fitters) {
  const chance = BALANCE.generator.helpChance;
  if (chance <= 0) return best.forms;
  // «Сжечь есть чем» мало: набор может гасить одну линию там, где другая
  // фигура гасит две. Помощь нужна, пока набор не дотягивает до максимума,
  // который на этом поле вообще достижим.
  const { keys, best: reach } = findKeys(board);
  const inSet = best.forms.reduce((m, f) => Math.max(m, bestClear(board, f)), 0);
  if (reach === 0 || inSet < reach) {
    const pool = keys.length || !fitters ? keys : pocketOrFit(board, allowance);
    if (!pool.length || rng.next() >= chance) return best.forms;
    return suggest(board, rng, best.forms, pool, -1).forms;
  }
  // Набор уже гасит максимум линий, но на поле стоит открытая ниша, а её
  // формы в наборе нет. Замер: ниши есть в 70% треев, а фигура ровно под нишу
  // попадалась лишь в 22% — отсюда ощущение «дали не то» при рабочем трее.
  // @spec GEN-HELP-006
  if (!fitters) return best.forms;
  const pocket = findPocketShapes(board, allowance);
  if (!pocket.length || best.forms.some((f) => pocket.some((p) => p.id === f.id))) return best.forms;
  if (rng.next() >= chance) return best.forms;
  return suggest(board, rng, best.forms, pocket, -1).forms;
}

// Замена самой неудобной фигуры набора на случайную из подсказанных.
function suggest(board, rng, forms, pool, keep) {
  if (!pool.length) return { forms, index: keep };
  const pick = pool[rng.int(pool.length)];
  if (forms.some((f) => f.id === pick.id)) return { forms, index: keep };
  return swapWorst(board, forms, pick, keep);
}

// Лучшая укладка фигуры на этом поле, на клетку фигуры.
function bestFit(board, shape) {
  measureFree(board);
  let best = -Infinity;
  for (let y = 0; y <= board.size - shape.h; y++) {
    for (let x = 0; x <= board.size - shape.w; x++) {
      if (!canPlace(board, shape, x, y)) continue;
      const v = fitAt(board, shape, x, y);
      if (v > best) best = v;
    }
  }
  return best === -Infinity ? best : best / shape.size;
}

// Сколько строк и столбцов стоят в шаге-двух от полной. Сигнал жалости:
// пока такие линии есть, невезение можно смягчить, не трогая правила.
// @spec GEN-MRCY-001
export function nearMissLines(board) {
  const n = board.size;
  const full = fullMask(n);
  let lines = 0;
  for (let y = 0; y < n; y++) {
    let miss = 0;
    let m = (~board.masks[y]) & full;
    while (m) { m &= m - 1; miss += 1; }
    if (miss >= 1 && miss <= 2) lines += 1;
  }
  for (let x = 0; x < n; x++) {
    let miss = 0;
    for (let y = 0; y < n; y++) if (!((board.masks[y] >> x) & 1)) miss += 1;
    if (miss >= 1 && miss <= 2) lines += 1;
  }
  return lines;
}

// Веса для «сжалившегося» слота: формы, которыми можно закрыть линию,
// тяжелеют в mercyBoost раз. Рулетка остаётся рулеткой — форма становится
// вероятнее, но игрок может её и не получить.
// @spec GEN-MRCY-003
function mercyWeights(board, weights) {
  const boost = BALANCE.generator.mercyBoost;
  return weights.map((w, i) => (bestClear(board, SHAPES[i]) > 0 ? w * boost : w));
}

// @spec GEN-PICK-001, GEN-GUAR-002, GEN-GUAR-003, GEN-SOLV-003, GEN-FAIR-001, GEN-DET-001
export function createGenerator(options = {}) {
  const requireFullSolvable = options.requireFullSolvable ?? false;
  const easyDeal = options.easyDeal ?? false;
  const favorSpace = options.favor === 'space';
  const smallFloor = options.smallFloor ?? 0;
  const bulky = options.bulky ?? false;
  const mercyAllowed = options.mercy ?? true;
  const stats = options.collectStats
    ? {
      issues: 0,
      regens: 0,
      forcedP1: 0,
      rescued: 0,
      mercy: 0,
      // раздачи и срабатывания жалости по корзинам заполненности
      byBucket: { свободно: [0, 0], средне: [0, 0], тесно: [0, 0] },
      solverCalls: 0,
      solverNodes: [],
    }
    : null;

  function provider(board, rng, opts) {
    const count = opts.count;
    const previous = opts.previous ?? null;
    if (stats) stats.issues += 1;

    const fill = fillRatio(board);
    const bucket = fill < BALANCE.generatorFill.low ? 'свободно'
      : (fill < BALANCE.generatorFill.high ? 'средне' : 'тесно');
    if (stats) stats.byBucket[bucket][0] += 1;
    const fair = opts.fairMode === true;
    // ТЗ 4.6: честный режим — только базовые веса, без адаптации и гарантий
    const weights = SHAPES.map((s) => (fair ? s.weight : shapeWeight(s, fill, bulky)));
    const total = weights.reduce((a, b) => a + b, 0);

    if (fair) return withColors(rng, pickForms(rng, count, weights, total));

    // Жалость: после полосы ходов без сгорания один слот тянется к формам,
    // закрывающим почти готовую линию. Счётчики ведёт ядро (CORE-SCORE-006),
    // провайдер остаётся без памяти между вызовами.
    // @spec GEN-MRCY-002, GEN-MRCY-004, GEN-MRCY-006
    const cfg = BALANCE.generator;
    let mercy = null;
    if (mercyAllowed && cfg.mercyEnabled && nearMissLines(board) >= 1) {
      const ripe = cfg.mercyAlwaysOn
        || ((opts.movesSinceClear ?? 0) >= cfg.mercyThreshold
          && (opts.dealsSinceMercy ?? 0) >= cfg.mercyCooldown);
      if (ripe) {
        const boosted = mercyWeights(board, weights);
        mercy = { weights: boosted, total: boosted.reduce((a, b) => a + b, 0) };
        opts.mercyApplied = true;
        if (stats) {
          stats.mercy += 1;
          stats.byBucket[bucket][1] += 1;
        }
      }
    }

    const allowance = smallAllowance(board, fill, smallFloor);
    let last = null;
    let guaranteedFallback = null;
    let best = null;
    let accepted = 0;
    for (let attempt = 0; attempt < BALANCE.generator.maxAttempts; attempt++) {
      const candidate = pickForms(rng, count, weights, total, mercy);
      last = candidate;
      if (violatesAntiPatterns(candidate, previous)) {
        if (stats) stats.regens += 1;
        continue;
      }
      if (smallCount(candidate) > allowance) {
        if (stats) stats.regens += 1;
        continue;
      }
      if (!hasPlaceable(board, candidate)) {
        if (stats) stats.regens += 1;
        continue;
      }
      if (requireFullSolvable) {
        const solvable = isFullyPlayable(board, candidate, BALANCE.generator.solverNodeBudget, stats);
        if (solvable !== true) { // «не доказано» разыгрываемостью не считается
          if (stats) stats.regens += 1;
          guaranteedFallback = guaranteedFallback ?? candidate;
          continue;
        }
      }
      if (!easyDeal) return withColors(rng, candidate);
      // щадящая раздача: из нескольких годных троек берём ту, которой можно
      // сжечь больше линий, и лишь при равенстве — самую свободную в укладке
      const {
        immediate, chains, total: lines, left, fit,
      } = dealChain(board, candidate);
      const comfort = dealComfort(board, candidate);
      const cells = candidate.reduce((n, f) => n + f.size, 0);
      // Порядок ключей: сколько ходов подряд можно сжигать → сколько линий →
      // третий ключ по режиму → свобода укладки.
      // В счётных режимах третьим идёт масса фигур: без неё выбор скатывался
      // в мелочь, которой серию тянуть проще, а игроку она скучна. В задачах
      // наоборот важен чистый остаток — там линию добивают через конкретную
      // клетку, и лишние клетки мешают (замер: 9 уровней с низким винрейтом
      // против нуля). «Очистить поле» поднимает остаток на первое место.
      const third = bulky ? cells : -left;
      const key = favorSpace
        ? [-left, immediate, chains, lines, fit, comfort]
        : [immediate, chains, lines, fit, third, comfort];
      if (!best || cmpKey(key, best.key) > 0) best = { forms: candidate, key, chains };
      accepted += 1;
      if (accepted >= BALANCE.generator.easyCandidates) break;
    }
    if (best) return withColors(rng, withHelp(board, rng, best, allowance, bulky));

    // Исчерпание лимита. Для режима с полной разыгрываемостью сначала пробуем
    // спасательный набор из точек: он разыгрывается всегда, пока на поле есть
    // свободные клетки, — игрок не должен упираться в тупик не по своей вине.
    if (requireFullSolvable) {
      const rescue = new Array(count).fill(SHAPE_BY_ID.P1);
      if (isFullyPlayable(board, rescue, BALANCE.generator.solverNodeBudget, stats) === true) {
        if (stats) stats.rescued += 1;
        return withColors(rng, rescue); // формы без PRNG, цвета как обычно
      }
    }
    // иначе последний кандидат с обычной гарантией; форс P1 — без PRNG на форму (ТЗ 4.1)
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
