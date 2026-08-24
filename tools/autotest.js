// Автотест генератора (ТЗ этап 3): случайный бот доказывает честность,
// жадный — меряет длину партии играющего, третьей фазой замеряется солвер.
// Запуск: node tools/autotest.js [randomGames] [greedyGames]
// @spec GEN-BOT-001, GEN-BOT-003
import { createGame } from '../src/core/game.js';
import { createGenerator, isFullyPlayable } from '../src/core/generator.js';
import { createRng } from '../src/core/rng.js';
import { SHAPES } from '../src/core/shapes.js';
import { cloneBoard, fillRatio } from '../src/core/bitboard.js';
import { BALANCE } from '../src/core/balance.js';
import { randomMove, greedyMove } from './bots.js';

const randomGames = Number(process.argv[2] ?? 1000);
const greedyGames = Number(process.argv[3] ?? 100);

function summarize(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  const med = s[Math.floor(s.length / 2)];
  return { min: s[0], max: s[s.length - 1], avg: Math.round(avg * 10) / 10, med };
}

// Несправедливая выдача: полный трей, ни одна фигура не помещается.
function playGame(seed, pickMove, provider, onBoard = null) {
  const game = createGame({ size: 8, seed, headless: true, trayProvider: provider });
  let unfair = 0;
  const fullAndStuck = (pieces, placeable) => pieces.filter(Boolean).length === 3
    && !placeable.some(Boolean);
  if (fullAndStuck(game.tray, game.placeable)) unfair += 1; // стартовая выдача
  game.on('trayChanged', ({ pieces, placeable }) => {
    if (fullAndStuck(pieces, placeable)) unfair += 1;
  });
  while (game.phase === 'playing') {
    const mv = pickMove(game);
    if (!mv) break;
    game.placePiece(mv.slot, mv.x, mv.y);
    if (onBoard && game.moveCount % 20 === 0) onBoard(cloneBoard(game.board));
  }
  return { moves: game.moveCount, score: game.score, unfair };
}

// --- фаза 1: случайный бот ---
const randomProvider = createGenerator({ collectStats: true });
let unfairTotal = 0;
const randomMoves = [];
for (let seed = 1; seed <= randomGames; seed++) {
  const botRng = createRng(0x9e3779b9 ^ seed);
  const r = playGame(seed, (g) => randomMove(g, botRng), randomProvider);
  unfairTotal += r.unfair;
  randomMoves.push(r.moves);
}

// --- фаза 2: жадный бот ---
const greedyProvider = createGenerator({ collectStats: true });
const greedyMovesArr = [];
const greedyScores = [];
const boards = [];
for (let seed = 1; seed <= greedyGames; seed++) {
  const r = playGame(100000 + seed, greedyMove, greedyProvider, (b) => boards.push(b));
  greedyMovesArr.push(r.moves);
  greedyScores.push(r.score);
}

// --- фаза 3: замер солвера на реальных срединных досках ---
const solverStats = { solverCalls: 0, solverNodes: [] };
const solverRng = createRng(424242);
const verdicts = { playable: 0, unplayable: 0, unproven: 0 };
for (const board of boards.slice(0, 60)) {
  const triple = [0, 1, 2].map(() => SHAPES[solverRng.int(SHAPES.length)]);
  const res = isFullyPlayable(board, triple, BALANCE.generator.solverNodeBudget, solverStats);
  if (res === true) verdicts.playable += 1;
  else if (res === false) verdicts.unplayable += 1;
  else verdicts.unproven += 1;
}

// --- отчёт ---
const rp = randomProvider.stats;
const gp = greedyProvider.stats;
console.log(`=== Случайный бот: ${randomGames} партий ===`);
console.log(`несправедливых выдач: ${unfairTotal} (обязано быть 0)`);
console.log('длина партии:', summarize(randomMoves));
console.log(`=== Жадный бот: ${greedyGames} партий ===`);
console.log('длина партии:', summarize(greedyMovesArr));
console.log('очки:', summarize(greedyScores));
console.log('=== Генератор ===');
console.log(`выдач: ${rp.issues + gp.issues}, перегенераций: ${rp.regens + gp.regens}`
  + ` (${Math.round(((rp.regens + gp.regens) / Math.max(1, rp.issues + gp.issues)) * 1000) / 10}% на выдачу),`
  + ` форсов P1: ${rp.forcedP1 + gp.forcedP1}`);
console.log(`=== Солвер: ${solverStats.solverCalls} вызовов на срединных досках жадного бота ===`);
if (solverStats.solverNodes.length) {
  console.log('узлов на вызов:', summarize(solverStats.solverNodes));
  console.log('вердикты:', verdicts, `(бюджет ${BALANCE.generator.solverNodeBudget})`);
}

if (unfairTotal > 0) {
  console.error('ПРОВАЛ: генератор выдал набор без единой размещаемой фигуры');
  process.exit(1);
}
