// Конечный автомат партии и конвейер хода. Ядро разрешает ход синхронно и
// сообщает события в фиксированном порядке; рендер разворачивает их во времени,
// а на это время ядро стоит в animating и отбрасывает ввод (не буферизует).
import {
  createBoard, applyInitialBoard, canPlace, anyFit, isOccupied,
  cellIndex, fillRatio, boardIsEmpty,
} from './bitboard.js';
import { SPECIAL } from './specials.js';
import { findFullLines, clearLines } from './placement.js';
import {
  placementPoints, clearPointsX10000, emptyBoardBonus, streakMult,
  finalizeMovePointsX10000,
} from './scoring.js';
import { SHAPE_BY_ID } from './shapes.js';
import { createRng } from './rng.js';
import { BALANCE } from './balance.js';

export const SAVE_VERSION = 1;
const TRAY_SIZE = 3;

// @spec CORE-DET-004, CORE-FSM-010
export function createGame(config) {
  return new GameCore(config, null);
}

// @spec CORE-SER-002, CORE-SER-003
export function deserializeGame(saved, config) {
  if (saved.version !== SAVE_VERSION) {
    // миграции — обязанность SAVE; ядро не пытается угадать чужую версию
    throw new Error(`unsupported save version: ${saved.version}`);
  }
  return new GameCore(config, saved);
}

class GameCore {
  constructor(config, saved) {
    if (typeof config.trayProvider !== 'function') {
      throw new Error('trayProvider is required');
    }
    this.cfg = {
      size: config.size ?? 8,
      seed: config.seed ?? 1,
      initialBoard: config.initialBoard ?? null,
      fairMode: config.fairMode ?? false,
      trayProvider: config.trayProvider,
      headless: config.headless ?? false,
      boosterCostsMove: config.boosterCostsMove ?? false,
      boosterTicksBombs: config.boosterTicksBombs ?? false,
    };
    this._listeners = new Map();
    this._resolving = false;
    this._endRequests = [];
    this.result = null;

    if (saved) {
      this._restorePlain(saved);
    } else {
      this.board = createBoard(this.cfg.size);
      if (this.cfg.initialBoard) applyInitialBoard(this.board, this.cfg.initialBoard);
      this.rng = createRng(this.cfg.seed);
      this.score = 0;
      this.streakStep = 0;
      this.moveCount = 0;
      this.boosters = { hammer: 0, shuffle: 0, undo: 0, ...(config.boosters ?? {}) };
      this.tray = new Array(TRAY_SIZE).fill(null);
      this.undoRing = [];
      this.lastIssued = null;
      this.phase = 'playing';
      this._refillTray();
      this._updatePlaceable();
      // в честном режиме поражение возможно уже на старте — это ожидаемо
      if (!this.placeable.some(Boolean)) this._finish('loss', 'no-fit');
    }
  }

  // --- события ---

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event).delete(fn);
  }

  _emit(event, payload) {
    const set = this._listeners.get(event);
    if (set) for (const fn of [...set]) fn(payload);
  }

  // --- конвейер хода ---

  // @spec CORE-MOVE-001, CORE-MOVE-002, CORE-MOVE-004, CORE-MOVE-005,
  // @spec CORE-MOVE-006, CORE-MOVE-007, CORE-MOVE-008, CORE-MOVE-009, CORE-MOVE-010
  // @spec CORE-SCORE-002, CORE-SCORE-004, CORE-SPC-009, CORE-FSM-003, CORE-FSM-005
  // @spec CORE-BOARD-005
  placePiece(slot, x, y) {
    if (this.phase !== 'playing' || this._resolving) return { ok: false, reason: 'state' };
    const piece = this.tray[slot];
    if (!piece) return { ok: false, reason: 'empty-slot' };
    const shape = SHAPE_BY_ID[piece.shapeId];
    if (!canPlace(this.board, shape, x, y)) return { ok: false, reason: 'invalid' };

    this._pushSnapshot();
    this._resolving = true;
    this._endRequests = [];

    const cells = shape.cells.map(([dx, dy]) => [x + dx, y + dy]);
    for (const [cx, cy] of cells) {
      this.board.masks[cy] |= 1 << cx;
      this.board.colors[cellIndex(this.board, cx, cy)] = piece.color;
    }
    this._emit('piecePlaced', { shapeId: piece.shapeId, cells, color: piece.color });

    let pointsX10000 = placementPoints(shape) * 10000;
    const { rows, cols } = findFullLines(this.board);
    const n = rows.length + cols.length;
    if (n > 0) {
      const res = clearLines(this.board, rows, cols);
      this._emit('linesCleared', { rows, cols, ...res, count: n });
      // детект пустого поля предшествует начислению: бонус входит
      // в единственный scoreChanged хода
      if (boardIsEmpty(this.board)) {
        this._emit('boardEmpty', {});
        pointsX10000 += emptyBoardBonus(this.board.size) * 10000;
      }
      pointsX10000 += clearPointsX10000(n, this.board.size, this.streakStep);
    }
    const delta = finalizeMovePointsX10000(pointsX10000);
    this.score += delta;
    this._emit('scoreChanged', { score: this.score, delta, source: 'move' });

    const prevStep = this.streakStep;
    this.streakStep = n > 0 ? prevStep + 1 : 0;
    if (this.streakStep !== prevStep) {
      this._emit('streakChanged', { step: this.streakStep, mult: streakMult(this.streakStep) });
    }

    this._tickBombs();
    this._emit('fillChanged', { ratio: fillRatio(this.board) });

    this.tray[slot] = null;
    if (this.tray.every((p) => p === null)) this._refillTray();
    this._updatePlaceable();
    this._emit('trayChanged', { pieces: this.trayView(), placeable: [...this.placeable] });
    const noFit = !this.placeable.some(Boolean);

    this.moveCount += 1;
    this._emit('moveResolved', { moveCount: this.moveCount, clearedCount: n, scoreDelta: delta });

    this._resolving = false;
    this._resolveOutcome(noFit);
    return { ok: true, cleared: n, scoreDelta: delta };
  }

  // --- бустеры ---

  // @spec CORE-BST-001, CORE-BST-002, CORE-BST-003, CORE-BST-007,
  // @spec CORE-BST-008, CORE-BST-009, CORE-BST-010,
  // @spec CORE-SPC-004, CORE-SPC-008
  applyBooster(type, args = {}) {
    if (this.phase !== 'playing' || this._resolving) return { ok: false, reason: 'state' };
    if (type === 'undo') return this.undo();
    if (type !== 'hammer' && type !== 'shuffle') return { ok: false, reason: 'unknown-booster' };
    if (this.boosters[type] < 1) return { ok: false, reason: 'no-stock' };
    if (type === 'hammer' && !isOccupied(this.board, args.x, args.y)) {
      return { ok: false, reason: 'empty' };
    }

    this._pushSnapshot();
    this._resolving = true;
    this._endRequests = [];
    this.boosters[type] -= 1;
    let boardChanged = false;

    if (type === 'hammer') {
      const { x, y } = args;
      const i = cellIndex(this.board, x, y);
      this.board.masks[y] &= ~(1 << x);
      this.board.colors[i] = 0;
      this.board.specials[i] = SPECIAL.NONE;
      this.board.specialData[i] = 0;
      // бит золота остаётся: золото закрывается только очисткой линии
      boardChanged = true;
    } else {
      // перемешивание меняет ровно занятые слоты — пустые остаются пустыми
      const slots = [0, 1, 2].filter((s) => this.tray[s]);
      const fresh = this._requestPieces(slots.length);
      slots.forEach((s, j) => { this.tray[s] = fresh[j]; });
    }

    if (this.cfg.boosterTicksBombs) this._tickBombs();
    if (this.cfg.boosterCostsMove) this.moveCount += 1;
    if (boardChanged) this._emit('fillChanged', { ratio: fillRatio(this.board) });
    this._updatePlaceable();
    this._emit('trayChanged', { pieces: this.trayView(), placeable: [...this.placeable] });
    const noFit = !this.placeable.some(Boolean);
    this._emit('boosterApplied', { type, left: this.boosters[type] });
    this._resolving = false;
    this._resolveOutcome(noFit);
    return { ok: true };
  }

  // @spec CORE-BST-004, CORE-BST-005, CORE-DET-002
  undo() {
    if (this.phase !== 'playing' || this._resolving) return { ok: false, reason: 'state' };
    if (this.boosters.undo < 1) return { ok: false, reason: 'no-stock' };
    if (this.undoRing.length === 0) return { ok: false, reason: 'empty' };
    this.boosters.undo -= 1; // расход не возвращается: запас вне снапшотов
    this._restoreSnapshot(this.undoRing.pop());
    this._updatePlaceable();
    this._emit('undoApplied', {
      score: this.score,
      streakStep: this.streakStep,
      moveCount: this.moveCount,
      undoLeft: this.boosters.undo,
    });
    this._emit('fillChanged', { ratio: fillRatio(this.board) });
    this._emit('trayChanged', { pieces: this.trayView(), placeable: [...this.placeable] });
    return { ok: true };
  }

  // @spec CORE-BST-011
  addBoosters(grant) {
    if (this.phase === 'over') return { ok: false, reason: 'state' };
    for (const [type, count] of Object.entries(grant)) {
      if (!(type in this.boosters) || !Number.isInteger(count) || count < 0) {
        return { ok: false, reason: 'bad-grant' };
      }
    }
    for (const [type, count] of Object.entries(grant)) this.boosters[type] += count;
    this._emit('boosterStockChanged', { stock: { ...this.boosters } });
    return { ok: true };
  }

  // --- FSM ---

  // @spec CORE-FSM-001, CORE-FSM-002, CORE-FSM-004
  animationsDone() {
    if (this.phase !== 'animating') return { ok: false };
    this.phase = 'playing';
    return { ok: true };
  }

  // @spec CORE-FSM-006
  pause() {
    if (this.phase !== 'playing' && this.phase !== 'animating') return { ok: false };
    // пауза из animating домалывает анимации: рендер применяет конечный кадр,
    // resume вернёт в playing — ждать animationsDone после потери фокуса некому
    this.phase = 'paused';
    return { ok: true };
  }

  resume() {
    if (this.phase !== 'paused') return { ok: false };
    this.phase = 'playing';
    return { ok: true };
  }

  // @spec CORE-FSM-007
  end(outcome, reason) {
    if (this._resolving) {
      this._endRequests.push({ outcome, reason });
      return { ok: true, buffered: true };
    }
    if (this.phase !== 'playing' && this.phase !== 'animating') return { ok: false };
    this._finish(outcome, reason);
    return { ok: true };
  }

  reset() {
    if (this.phase !== 'over') return { ok: false };
    this.phase = 'idle';
    return { ok: true };
  }

  // @spec CORE-FSM-009
  _resolveOutcome(noFitCandidate) {
    const win = this._endRequests.find((r) => r.outcome === 'win');
    const loss = this._endRequests.find((r) => r.outcome === 'loss');
    this._endRequests = [];
    if (win) this._finish('win', win.reason);
    else if (loss) this._finish('loss', loss.reason);
    else if (noFitCandidate) this._finish('loss', 'no-fit');
    else this.phase = this.cfg.headless ? 'playing' : 'animating';
  }

  // @spec CORE-FSM-008
  _finish(outcome, reason) {
    this.phase = 'over';
    this.result = { outcome, reason };
    this._emit('gameOver', { outcome, reason });
  }

  // --- внутренности ---

  // @spec CORE-SPC-006
  _tickBombs() {
    const cells = [];
    const timers = [];
    const exploded = [];
    const { board } = this;
    for (let y = 0; y < board.size; y++) {
      for (let x = 0; x < board.size; x++) {
        const i = cellIndex(board, x, y);
        if (board.specials[i] !== SPECIAL.BOMB) continue;
        board.specialData[i] -= 1;
        cells.push({ x, y });
        timers.push(board.specialData[i]);
        if (board.specialData[i] === 0) exploded.push({ x, y });
      }
    }
    if (cells.length) this._emit('bombTick', { cells, timers });
    for (const cell of exploded) this._emit('bombExploded', { cell });
  }

  // Полное пополнение обновляет lastIssued и передаёт previous для анти-повтора
  // генератора; перемешивание (_requestPieces напрямую) не делает ни того ни другого.
  _refillTray() {
    const pieces = this._requestPieces(TRAY_SIZE, this.lastIssued);
    this.tray = pieces;
    this.lastIssued = pieces.map((p) => p.shapeId);
  }

  _requestPieces(count, previous = null) {
    const opts = { count, fairMode: this.cfg.fairMode };
    if (previous) opts.previous = previous;
    const pieces = this.cfg.trayProvider(this.board, this.rng, opts);
    if (!Array.isArray(pieces) || pieces.length !== count) {
      throw new Error(`trayProvider must return exactly ${count} pieces`);
    }
    return pieces.map((p) => {
      if (!SHAPE_BY_ID[p.shapeId]) throw new Error(`unknown shape: ${p.shapeId}`);
      return { shapeId: p.shapeId, color: p.color };
    });
  }

  _updatePlaceable() {
    this.placeable = this.tray.map((p) => (p ? anyFit(this.board, SHAPE_BY_ID[p.shapeId]) : false));
  }

  trayView() {
    return this.tray.map((p) => (p ? { ...p } : null));
  }

  canPlacePiece(slot, x, y) {
    const piece = this.tray[slot];
    return piece ? canPlace(this.board, SHAPE_BY_ID[piece.shapeId], x, y) : false;
  }

  // --- снапшоты и сериализация ---

  _snapshotState() {
    return {
      masks: Array.from(this.board.masks),
      colors: Array.from(this.board.colors),
      specials: Array.from(this.board.specials),
      specialData: Array.from(this.board.specialData),
      goldMask: Array.from(this.board.goldMask),
      tray: this.trayView(),
      score: this.score,
      streakStep: this.streakStep,
      moveCount: this.moveCount,
      lastIssued: this.lastIssued ? [...this.lastIssued] : null,
      rngState: this.rng.getState(),
    };
  }

  _pushSnapshot() {
    if (this.undoRing.length >= BALANCE.undoDepth) this.undoRing.shift();
    this.undoRing.push(this._snapshotState());
  }

  _restoreSnapshot(snap) {
    this.board.masks.set(snap.masks);
    this.board.colors.set(snap.colors);
    this.board.specials.set(snap.specials);
    this.board.specialData.set(snap.specialData);
    this.board.goldMask.set(snap.goldMask);
    this.tray = snap.tray.map((p) => (p ? { ...p } : null));
    this.score = snap.score;
    this.streakStep = snap.streakStep;
    this.moveCount = snap.moveCount;
    this.lastIssued = snap.lastIssued ? [...snap.lastIssued] : null;
    this.rng.setState(snap.rngState);
  }

  // Кольцо undo в сейв не входит: пять снапшотов поля — заметный объём при
  // автосейве каждый ход, а отмена после перезагрузки никем не ожидается.
  // @spec CORE-SER-001, CORE-DET-003
  serialize() {
    return {
      version: SAVE_VERSION,
      size: this.board.size,
      // animating — чисто визуальное состояние: логически ход уже разрешён
      phase: this.phase === 'animating' ? 'playing' : this.phase,
      result: this.result,
      ...this._snapshotState(),
      boosters: { ...this.boosters },
    };
  }

  _restorePlain(saved) {
    this.board = createBoard(saved.size);
    this.board.masks.set(saved.masks);
    this.board.colors.set(saved.colors);
    this.board.specials.set(saved.specials);
    this.board.specialData.set(saved.specialData);
    this.board.goldMask.set(saved.goldMask);
    this.tray = saved.tray.map((p) => (p ? { ...p } : null));
    this.score = saved.score;
    this.streakStep = saved.streakStep;
    this.moveCount = saved.moveCount;
    this.lastIssued = saved.lastIssued ? [...saved.lastIssued] : null;
    this.boosters = { hammer: 0, shuffle: 0, undo: 0, ...saved.boosters };
    this.rng = createRng(1);
    this.rng.setState(saved.rngState);
    this.undoRing = [];
    this.phase = saved.phase;
    this.result = saved.result;
    this._updatePlaceable();
  }
}
