// Генератор уровней режима «Задачи». Раскладки создаются процедурно по
// шаблонам с нарастающей сложностью, каждая проверяется тем же ботом, что и
// верификатор: в билд попадают только те, что реально проходятся при нулевом
// запасе бустеров. Выдаёт готовые записи в строковом формате.
// Запуск: node tools/gen-levels.mjs [сколько] [сидов на проверку]
import { createGame } from '../src/core/game.js';
import { createGenerator } from '../src/core/generator.js';
import { createRng } from '../src/core/rng.js';
import { goalDone } from '../src/content/goals.js';
import { parseBoard } from '../src/levels/format.js';
import { goalBotMove } from './level-bot.js';

const WANT = Number(process.argv[2] ?? 80);
const SEEDS = Number(process.argv[3] ?? 12);
const SIZE = 8;

// «Очисти поле» в ротацию не берём: цель проходима (уровни 4 и 12 это
// подтверждают), но её винрейт — лотерея на первых тройках, и штамповать
// такие уровни десятками значит наполнить игру перезапусками.
const GOALS = ['score', 'ice', 'gold', 'bombs', 'streak'];

// Планка винрейта бота. У «очисти поле» она ниже осознанно: бот засоряет поле
// там, где человек ждёт нужную фигуру, — проверенные вручную уровни 4 и 12
// дают ботом те же ~35%, но людьми проходятся.
// с запасом над порогом верификатора (0.4): уровень должен проходить
// уверенно, а не впритык на удачной выборке сидов
const PASS_RATE = { clearBoard: 0.34, default: 0.6 };

// Что разрешено на каком отрезке: сложность нарастает по мере продвижения.
function palette(id) {
  if (id <= 40) return { ice: true, thickIce: false, stone: true, bomb: false };
  if (id <= 60) return { ice: true, thickIce: false, stone: true, bomb: true };
  if (id <= 80) return { ice: true, thickIce: true, stone: true, bomb: true };
  return { ice: true, thickIce: true, stone: true, bomb: true };
}

function emptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill('.'));
}

const rowFull = (grid, y) => grid[y].every((c) => c !== '.' && c !== 'g');
const colFull = (grid, x) => grid.every((row) => row[x] !== '.' && row[x] !== 'g');

// Ставим символ, если это не создаёт заполненную линию: полная линия на старте
// сгорела бы от любого первого хода и обесценила бы уровень.
function place(grid, x, y, ch) {
  if (grid[y][x] !== '.') return false;
  grid[y][x] = ch;
  if (rowFull(grid, y) || colFull(grid, x)) { grid[y][x] = '.'; return false; }
  return true;
}

// Цель «очистить поле» на случайном мусоре недостижима: чтобы поле опустело,
// всё поставленное обязано сгореть. Такие уровни строятся шаблоном — сплошные
// ряды с общим окном: закрыл окно, ряды сгорели, поле чистое.
function buildClearGrid(rng, id) {
  const grid = emptyGrid();
  const hard = Math.min(1, (id - 20) / 80);
  const rowsCount = 2 + (hard > 0.5 ? 1 : 0);
  const top = 8 - rowsCount;
  const gapW = 2 + rng.int(2);          // ширина окна
  const gapX = rng.int(SIZE - gapW);
  const p = palette(id);
  for (let y = top; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x >= gapX && x < gapX + gapW) continue;
      // камень в такой раскладке безопасен: он сгорает вместе со своей линией
      const ch = p.stone && rng.next() < hard * 0.18 ? 's' : '#';
      grid[y][x] = ch;
    }
  }
  return grid;
}

// Для стрика нужны заготовленные почти полные ряды — иначе очистки подряд
// приходится собирать с нуля, и цель упирается в удачу выдачи.
function buildStreakGrid(rng, id) {
  const grid = emptyGrid();
  const hard = Math.min(1, (id - 20) / 80);
  const lines = 2 + Math.round(hard * 2);
  const used = new Set();
  for (let i = 0; i < lines; i++) {
    let y;
    do { y = rng.int(SIZE); } while (used.has(y));
    used.add(y);
    const gap = 1 + rng.int(2);
    const gapX = rng.int(SIZE - gap);
    for (let x = 0; x < SIZE; x++) {
      if (x >= gapX && x < gapX + gap) continue;
      grid[y][x] = '#';
    }
  }
  return grid;
}

function buildGrid(rng, id, goalType) {
  if (goalType === 'clearBoard') return buildClearGrid(rng, id);
  if (goalType === 'streak') return buildStreakGrid(rng, id);
  const p = palette(id);
  const grid = emptyGrid();
  const hard = Math.min(1, (id - 20) / 80); // 0 в начале блока, 1 к сотому
  const clutter = Math.round(6 + hard * 18);

  const put = (ch, count) => {
    let placed = 0;
    for (let guard = 0; guard < count * 40 && placed < count; guard++) {
      if (place(grid, rng.int(SIZE), rng.int(SIZE), ch)) placed += 1;
    }
    return placed;
  };

  // сначала цель — ей нужно гарантированное место, потом фоновый мусор
  const targets = {};
  if (goalType === 'ice') {
    const thick = p.thickIce && rng.next() < 0.45;
    targets.ice = put(thick ? 'I' : 'i', 3 + Math.round(hard * 5));
  } else if (goalType === 'gold') {
    targets.gold = put('g', 2 + Math.round(hard * 4));
  } else if (goalType === 'bombs') {
    targets.bombs = put('b', 2 + Math.round(hard * 3));
  }
  if (p.stone) put('s', Math.round(hard * 4));
  put('#', clutter);
  return grid;
}

function makeGoal(rng, id, goalType, gridStats) {
  const hard = Math.min(1, (id - 20) / 80);
  switch (goalType) {
    case 'score': {
      const moves = 14 + rng.int(10);
      return { goal: { type: 'score', x: Math.round((22 + hard * 14) * moves) }, moveLimit: moves };
    }
    case 'streak':
      return { goal: { type: 'streak', n: 2 + Math.round(hard * 2) }, moveLimit: 18 + rng.int(12) };
    case 'clearBoard':
      return { goal: { type: 'clearBoard' }, moveLimit: null };
    case 'ice':
      return { goal: { type: 'ice' }, moveLimit: 18 + Math.round(hard * 14) + rng.int(8) };
    case 'gold':
      return { goal: { type: 'gold' }, moveLimit: 18 + Math.round(hard * 12) + rng.int(8) };
    case 'bombs':
      return { goal: { type: 'bombs' }, moveLimit: 16 + Math.round(hard * 10) + rng.int(8) };
    default:
      return { goal: { type: 'score', x: 400 }, moveLimit: 20 };
  }
}

// Прогон целевым ботом при нулевом запасе бустеров — то же, что делает
// верификатор: уровень обязан проходиться без единого бустера (п. 4.5.2).
function winRate(level, seeds) {
  const provider = createGenerator({ requireFullSolvable: true });
  let wins = 0;
  const moveCounts = [];
  for (let s = 1; s <= seeds; s++) {
    const game = createGame({
      size: SIZE, seed: 1000 + s, headless: true,
      initialBoard: parseBoard(level), trayProvider: provider,
      boosters: { hammer: 0, shuffle: 0, undo: 0 },
    });
    const check = () => {
      if (game.phase !== 'playing') return;
      if (goalDone(game, level.goal)) game.end('win', 'goal');
      else if (level.moveLimit && game.moveCount >= level.moveLimit) game.end('loss', 'moves');
    };
    game.on('moveResolved', check);
    game.on('bombExploded', () => game.end('loss', 'bomb'));
    let guard = 0;
    while (game.phase === 'playing' && guard++ < 400) {
      const mv = goalBotMove(game, level);
      if (!mv) break;
      game.placePiece(mv.slot, mv.x, mv.y);
    }
    if (game.result?.outcome === 'win') { wins += 1; moveCounts.push(game.moveCount); }
  }
  const med = moveCounts.sort((a, b) => a - b)[Math.floor(moveCounts.length / 2)] ?? 0;
  return { rate: wins / seeds, medMoves: med };
}

const levels = [];
const rng = createRng(20260827);
let attempts = 0;
for (let n = 0; n < WANT; n++) {
  const id = 21 + n;
  const goalType = GOALS[n % GOALS.length];
  let accepted = null;
  for (let tryIdx = 0; tryIdx < 26 && !accepted; tryIdx++) {
    attempts += 1;
    const grid = buildGrid(rng, id, goalType);
    const { goal, moveLimit } = makeGoal(rng, id, goalType, grid);
    // послабление на каждой неудачной попытке: цели легче, ходов больше
    const relax = tryIdx;
    const cand = {
      id,
      rows: grid.map((r) => r.join('')),
      goal: goal.type === 'score' ? { type: 'score', x: Math.round(goal.x * (1 - relax * 0.06)) } : goal,
      moveLimit: moveLimit ? moveLimit + relax * 2 : null,
      star2Moves: 0,
      bombTimer: 10 + Math.round(Math.min(1, (id - 20) / 80) * 6) + relax,
    };
    const board = parseBoard(cand);
    const game = createGame({
      size: SIZE, seed: 1, headless: true, initialBoard: board,
      trayProvider: () => [{ shapeId: 'P1', color: 1 }, { shapeId: 'P1', color: 2 }, { shapeId: 'P1', color: 3 }],
    });
    if (goalDone(game, cand.goal)) continue; // цель выполнена до первого хода
    const { rate, medMoves } = winRate(cand, SEEDS);
    if (rate >= (PASS_RATE[goalType] ?? PASS_RATE.default)) {
      cand.star2Moves = Math.max(3, cand.moveLimit ? Math.min(cand.moveLimit - 1, Math.round(medMoves * 0.85) || 5) : Math.round(medMoves * 0.85) || 8);
      cand.winRate = rate;
      accepted = cand;
    }
  }
  if (!accepted) {
    // тип цели оказался неподъёмным на этой сложности — берём очки: они
    // достижимы на любой раскладке, лишь бы хватало ходов
    for (let tryIdx = 0; tryIdx < 14 && !accepted; tryIdx++) {
      const grid = buildGrid(rng, id, 'score');
      const moves = 18 + tryIdx * 2;
      const cand = {
        id, rows: grid.map((r) => r.join('')),
        goal: { type: 'score', x: Math.round(20 * moves * (1 - tryIdx * 0.05)) },
        moveLimit: moves, star2Moves: 0, bombTimer: 14,
      };
      const { rate, medMoves } = winRate(cand, SEEDS);
      if (rate >= 0.6) {
        cand.star2Moves = Math.max(3, Math.min(moves - 1, Math.round(medMoves * 0.85) || 6));
        cand.winRate = rate;
        cand.fallback = true;
        accepted = cand;
      }
    }
  }
  if (!accepted) {
    console.error(`уровень ${id}: не удалось подобрать проходимую раскладку`);
    process.exit(1);
  }
  levels.push(accepted);
  if ((n + 1) % 10 === 0) console.error(`готово ${n + 1}/${WANT}, попыток всего ${attempts}`);
}

console.log(JSON.stringify(levels));
