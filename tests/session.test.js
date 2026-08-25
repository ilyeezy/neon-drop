import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/content/session.js';
import { createStubPlatform } from '../src/platform/stub.js';
import { defaultSave } from '../src/save/storage.js';
import { dailyDateKey } from '../src/content/modes.js';

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
  // фиксируем дату дозаправки: иначе ежедневный добор поднял бы запас до 3/3/3
  // и тесты проверяли бы не то, что задают
  data.boostersRefilledOn = dailyDateKey();
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

// Молот — режим прицеливания, а не мгновенное действие: раньше выйти из него
// можно было только ткнув в поле, промах по пустой клетке был единственной
// отменой.
test('молот включается и выключается повторным нажатием', () => {
  const { session, screens } = makeSession({ boosters: { hammer: 2, shuffle: 0, undo: 0 } });
  session.startMode('classic');
  assert.equal(session.hammerActive, false);
  session.useBooster('hammer');
  assert.equal(session.hammerActive, true, 'первое нажатие включает прицеливание');
  const hudCalls = screens.calls.filter((c) => c[0] === 'updateHud');
  assert.equal(hudCalls.at(-1)[2].hammerActive, true, 'HUD знает про активный режим');
  session.useBooster('hammer');
  assert.equal(session.hammerActive, false, 'повторное нажатие выключает');
  assert.equal(session.game.boosters.hammer, 2, 'включение и выключение ничего не тратит');
});

test('промах молотом по пустой клетке режим не сбрасывает, удар — сбрасывает', () => {
  const { session } = makeSession({ boosters: { hammer: 2, shuffle: 0, undo: 0 } });
  session.startMode('classic');
  const game = session.game;
  const slot = game.tray.findIndex(Boolean);
  outer: for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (game.canPlacePiece(slot, x, y)) { session.placePiece(slot, x, y); break outer; }
    }
  }
  session.syncAnimations();
  session.useBooster('hammer');
  const empty = (() => {
    for (let y = 7; y >= 0; y--) for (let x = 7; x >= 0; x--) if (!((game.board.masks[y] >> x) & 1)) return { x, y };
    return null;
  })();
  session.hammerCell(empty.x, empty.y);
  assert.equal(session.hammerActive, true, 'промах не выкидывает из режима');
  assert.equal(game.boosters.hammer, 2, 'промах не тратит бустер');
  const filled = (() => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((game.board.masks[y] >> x) & 1) return { x, y };
    return null;
  })();
  session.hammerCell(filled.x, filled.y);
  assert.equal(session.hammerActive, false, 'после удара режим выключается');
  assert.equal(game.boosters.hammer, 1);
});

test('Escape и пауза гасят режим молота', () => {
  const { session } = makeSession({ boosters: { hammer: 2, shuffle: 0, undo: 0 } });
  session.startMode('classic');
  session.useBooster('hammer');
  session.cancelHammer();
  assert.equal(session.hammerActive, false);
  session.useBooster('hammer');
  session.pause();
  assert.equal(session.hammerActive, false, 'пауза снимает прицеливание');
});

// Награда за рекламу — три бустера одного типа на выбор игрока.
test('rewarded выдаёт 3 бустера выбранного типа', () => {
  const { session, save } = makeSession({ boosters: { hammer: 0, shuffle: 0, undo: 0 } });
  session.startMode('classic');
  session.grantBoosters('shuffle');
  assert.equal(session.game.boosters.shuffle, 3);
  assert.equal(session.game.boosters.hammer, 0, 'другие типы не трогаются');
  assert.equal(save.boosters.shuffle, 3, 'пул в сейве обновлён');
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

// Регрессия: ожидание конца анимации осыпания шло на requestAnimationFrame,
// и в фоновой вкладке (кадров нет) экран результата не показывался никогда —
// игра выглядела зависшей после проигрыша.
test('экран результата показывается даже когда кадры не идут', async () => {
  const { session, renderer, screens } = makeSession({ boosters: { hammer: 0, shuffle: 0, undo: 0 } });
  session.startMode('classic');
  renderer.setBusy(true); // рендер «занят» и никогда не освободится: кадров нет
  session.game.end('loss', 'test-quit');
  assert.equal(screens.calls.some((c) => c[0] === 'result'), false, 'сразу не показываем');
  await new Promise((r) => setTimeout(r, 2300)); // потолок ожидания 2 с
  assert.equal(screens.calls.some((c) => c[0] === 'result'), true, 'показан по таймеру');
});

// После победы в задачах игрок должен идти дальше прямо с экрана результата,
// а не выходить в меню и заново искать уровень в списке.
test('победа на уровне предлагает следующий уровень', () => {
  const { session, screens } = makeSession();
  session.startMode('levels', 1);
  session.game.end('win', 'goal');
  const result = screens.calls.find((c) => c[0] === 'result')[1];
  assert.equal(result.outcome, 'win');
  assert.equal(result.nextLevelId, 2, 'предлагаем второй уровень');
});

test('проигрыш и последний уровень кнопку не показывают', () => {
  const lost = makeSession();
  lost.session.startMode('levels', 1);
  lost.session.game.end('loss', 'moves');
  assert.equal(lost.screens.calls.find((c) => c[0] === 'result')[1].nextLevelId, null,
    'после проигрыша идти дальше некуда');

  const last = makeSession();
  last.session.startMode('levels', 20);
  last.session.game.end('win', 'goal');
  assert.equal(last.screens.calls.find((c) => c[0] === 'result')[1].nextLevelId, null,
    'после последнего уровня следующего нет');

  const classic = makeSession();
  classic.session.startMode('classic');
  classic.session.game.end('loss', 'no-fit');
  assert.equal(classic.screens.calls.find((c) => c[0] === 'result')[1].nextLevelId, null,
    'в классике уровней нет');
});
