import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/content/session.js';
import { createStubPlatform } from '../src/platform/stub.js';
import { defaultSave } from '../src/save/storage.js';

// Фейки внешнего мира: session принимает все зависимости инжекцией, поэтому
// связка «ядро ↔ рендер ↔ ввод» проверяется без DOM и канваса.
function fakeRenderer() {
  let busyFlag = false;
  return {
    attach() {}, setLayout() {}, setTheme() {}, setDrag() {}, setCursor() {},
    setHammerMode() {}, burstAt() {}, step() {},
    busy: () => busyFlag,
    setBusy(v) { busyFlag = v; },
  };
}

function fakeScreens() {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    updateHud: rec('updateHud'), hideAll: rec('hideAll'), menu: rec('menu'),
    pause: rec('pause'), result: rec('result'), levels: rec('levels'),
    themes: rec('themes'), settings: rec('settings'), howto: rec('howto'),
    tutorialHint: rec('tutorialHint'),
    currentName: null,
  };
}

function makeSession({ boosters } = {}) {
  const renderer = fakeRenderer();
  const data = defaultSave(1);
  if (boosters) data.boosters = { ...boosters };
  const saveMgr = { data, commit() {} };
  const metrics = { cellPx: 40, boardOrigin: { x: 0, y: 0 }, traySlots: [], trayCell: 20, w: 400, h: 800, dpr: 1 };
  const layout = { metrics, setGameSize: () => metrics, recompute: () => metrics };
  const session = createSession({
    platform: createStubPlatform({ storage: new Map() }),
    saveMgr,
    renderer,
    layout,
    dragInput: { setHammerMode() {}, cancel() {} },
  });
  const screens = fakeScreens();
  session.setScreens(screens);
  return { session, renderer, screens, save: data };
}

// Регрессия: у молота и перемешивания нет собственных блокирующих эффектов,
// поэтому на схеме «выход из animating по событию освобождения очереди»
// ядро оставалось в animating навсегда и весь ввод отвергался.
test('после молота ввод не залипает: animating снимается по пустой очереди', () => {
  const { session, renderer } = makeSession({ boosters: { hammer: 3, shuffle: 3, undo: 3 } });
  session.startMode('classic');
  const game = session.game;
  // ставим фигуру, чтобы было что бить молотом
  const slot = game.tray.findIndex(Boolean);
  const shape = game.tray[slot].shapeId;
  outer: for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (game.canPlacePiece(slot, x, y)) { session.placePiece(slot, x, y); break outer; }
    }
  }
  session.syncAnimations(); // кадр рендера: очередь пуста
  assert.equal(game.phase, 'playing', `после постановки фигуры ${shape}`);

  const cell = (() => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((game.board.masks[y] >> x) & 1) return { x, y };
    return null;
  })();
  session.hammerCell(cell.x, cell.y);
  assert.equal(game.phase, 'animating', 'бустер уводит ядро в animating');
  session.syncAnimations();
  assert.equal(game.phase, 'playing', 'ввод разблокирован после кадра');
  // и игра действительно принимает следующий ход
  const nextSlot = game.tray.findIndex(Boolean);
  let placed = false;
  for (let y = 0; y < 8 && !placed; y++) {
    for (let x = 0; x < 8 && !placed; x++) {
      if (game.canPlacePiece(nextSlot, x, y)) placed = session.placePiece(nextSlot, x, y);
    }
  }
  assert.equal(placed, true, 'после молота фигуры снова ставятся');
});

test('после перемешивания ввод не залипает', () => {
  const { session } = makeSession({ boosters: { hammer: 3, shuffle: 3, undo: 3 } });
  session.startMode('classic');
  const game = session.game;
  session.useBooster('shuffle');
  assert.equal(game.phase, 'animating');
  session.syncAnimations();
  assert.equal(game.phase, 'playing');
  assert.equal(game.boosters.shuffle, 2);
});

test('пока очередь эффектов не пуста, ввод остаётся закрытым', () => {
  const { session, renderer } = makeSession({ boosters: { hammer: 3, shuffle: 3, undo: 3 } });
  session.startMode('classic');
  const game = session.game;
  renderer.setBusy(true); // рендер доигрывает очистку
  session.useBooster('shuffle');
  session.syncAnimations();
  assert.equal(game.phase, 'animating', 'ядро ждёт конца анимации');
  renderer.setBusy(false);
  session.syncAnimations();
  assert.equal(game.phase, 'playing');
});

test('undo не уводит в animating и остаётся доступным сразу', () => {
  const { session } = makeSession({ boosters: { hammer: 3, shuffle: 3, undo: 3 } });
  session.startMode('classic');
  const game = session.game;
  const slot = game.tray.findIndex(Boolean);
  outer: for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (game.canPlacePiece(slot, x, y)) { session.placePiece(slot, x, y); break outer; }
    }
  }
  session.syncAnimations();
  const before = game.moveCount;
  session.useBooster('undo');
  assert.equal(game.phase, 'playing');
  assert.equal(game.moveCount, before - 1);
});
