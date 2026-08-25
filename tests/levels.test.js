import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels/levels.js';
import { createBoard, applyInitialBoard, fullMask, isOccupied } from '../src/core/bitboard.js';
import { findFullLines } from '../src/core/placement.js';
import { goalText, goalDone } from '../src/content/goals.js';
import { createGame } from '../src/core/game.js';
import { scripted, trioP1 } from './_helpers.js';

test('20 уровней с уникальными id и корректными целями', () => {
  assert.equal(LEVELS.length, 20);
  assert.deepEqual(LEVELS.map((l) => l.id), Array.from({ length: 20 }, (_, i) => i + 1));
  const types = new Set(LEVELS.map((l) => l.goal.type));
  for (const type of ['score', 'gold', 'ice', 'bombs', 'clearBoard', 'streak']) {
    assert.ok(types.has(type), `тип цели не используется: ${type}`);
  }
  for (const level of LEVELS) {
    // лимит ходов необязателен: есть уровни на терпение, а не на скорость
    if (level.moveLimit !== undefined) {
      assert.ok(level.moveLimit > 0, `битый лимит ходов: ${level.id}`);
      assert.ok(level.star2Moves < level.moveLimit, `порог второй звезды не строже лимита: ${level.id}`);
    }
    assert.ok(level.star2Moves > 0, `нет порога второй звезды: ${level.id}`);
    assert.ok(goalText(level).length > 0);
  }
  assert.equal(LEVELS.find((l) => l.id === 4).moveLimit, undefined, 'на 4 уровне лимита нет');
});

test('раскладки: без дублей клеток и валидны по инвариантам ядра', () => {
  for (const level of LEVELS) {
    const seen = new Set();
    for (const c of level.board) {
      const key = `${c.x},${c.y}`;
      assert.ok(!seen.has(key), `уровень ${level.id}: дубль клетки ${key}`);
      seen.add(key);
    }
    assert.doesNotThrow(() => applyInitialBoard(createBoard(8), level.board), `уровень ${level.id}`);
  }
});

// Полная линия в стартовой раскладке = победа любым первым ходом: линия
// сгорает на первом же findFullLines, независимо от того, что сделал игрок.
test('раскладки: ни одной изначально полной линии и цель не выполнена на старте', () => {
  for (const level of LEVELS) {
    const board = applyInitialBoard(createBoard(8), level.board);
    const { rows, cols } = findFullLines(board);
    assert.deepEqual(rows, [], `уровень ${level.id}: полная строка на старте`);
    assert.deepEqual(cols, [], `уровень ${level.id}: полный столбец на старте`);
    const game = createGame({
      size: 8, seed: 1, headless: true, initialBoard: level.board, trayProvider: scripted(trioP1()),
    });
    assert.equal(goalDone(game, level.goal), false, `уровень ${level.id}: цель выполнена до хода`);
  }
});

test('прогрессия спецблоков по ТЗ: 1–4 чисто, 5–9 лёд, 10–14 + камень, 15+ бомбы', () => {
  const kinds = (level) => new Set(level.board.map((c) => c.special).filter(Boolean));
  for (const level of LEVELS) {
    const k = kinds(level);
    if (level.id <= 4) assert.equal(k.size, 0, `уровень ${level.id}: спецблоки слишком рано`);
    if (level.id <= 9) assert.ok(!k.has('stone') && !k.has('bomb'), `уровень ${level.id}`);
    if (level.id <= 14) assert.ok(!k.has('bomb'), `уровень ${level.id}: бомбы раньше 15-го`);
  }
  assert.ok(LEVELS.slice(4, 9).some((l) => kinds(l).has('ice')));
  assert.ok(LEVELS.slice(9, 14).some((l) => kinds(l).has('stone')));
  assert.ok(LEVELS.slice(14).some((l) => kinds(l).has('bomb')));
  // толстый лёд (hp 2) — не раньше 15-го уровня
  for (const level of LEVELS) {
    const thick = level.board.some((c) => c.special === 'ice' && c.hp === 2);
    if (thick) assert.ok(level.id >= 15, `уровень ${level.id}: толстый лёд слишком рано`);
  }
});

test('золото в раскладках — только на пустых клетках', () => {
  for (const level of LEVELS) {
    for (const c of level.board) {
      if (c.gold) {
        assert.equal(c.color, undefined, `уровень ${level.id}: золото на блоке`);
        assert.equal(c.special, undefined, `уровень ${level.id}: золото на спецблоке`);
      }
    }
    const board = applyInitialBoard(createBoard(8), level.board);
    for (const c of level.board) {
      if (c.gold) assert.equal(isOccupied(board, c.x, c.y), false);
    }
  }
});

// Тема должна менять весь облик игры, а не только цвета фигур: если у новой
// темы забыть тон спецблоков или палитру интерфейса — часть экрана останется
// от предыдущей темы, и это заметно только глазами.
test('каждая тема задаёт полный набор цветов', async () => {
  const { THEMES } = await import('../src/render/themes.js');
  assert.equal(THEMES.length, 6);
  const ids = new Set();
  for (const th of THEMES) {
    assert.ok(!ids.has(th.id), `дубль темы ${th.id}`);
    ids.add(th.id);
    assert.equal(th.colors.length, 7, `${th.id}: 7 цветов фигур`);
    assert.equal(th.bg.length, 2, `${th.id}: градиент фона`);
    for (const key of ['accent', 'grid', 'gold', 'ice', 'stone', 'bomb', 'ui']) {
      assert.ok(th[key], `${th.id}: нет ${key}`);
    }
    assert.ok(th.ice.fill && th.ice.crack, `${th.id}: лёд`);
    assert.equal(th.stone.length, 2, `${th.id}: камень`);
    assert.ok(th.bomb.core && th.bomb.edge && th.bomb.glow, `${th.id}: бомба`);
    for (const key of ['panel', 'border', 'text', 'overlay']) {
      assert.ok(th.ui[key], `${th.id}: ui.${key}`);
    }
    for (const c of [...th.colors, th.accent, th.gold, ...th.bg]) {
      assert.match(c, /^#[0-9a-f]{6}$/i, `${th.id}: цвет ${c} должен быть hex`);
    }
  }
});
