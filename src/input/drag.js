// DOM-обвязка drag & drop: только Pointer Events — один код на мышь, тач и
// стилус (ТЗ п. 5). Вся математика — в чистой drag-logic; здесь захват
// указателя, пружинный возврат и защита от «залипших» фигур.
import { evaluateDrag } from './drag-logic.js';
import { SHAPE_BY_ID } from '../core/shapes.js';

const RETURN_MS = 200;
const easeOutBack = (k) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);

export function createDragInput({ canvas, getGame, getLayout, renderer, onPlace, onHammerCell, onPointerNorm, onLift, onReject }) {
  let drag = null;       // { slot, shape, color, pointerId, liftPx, lastEval }
  let returning = null;
  let hammerMode = false;

  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  function trayHit(p) {
    const layout = getLayout();
    const zone = Math.max(48, layout.trayCell * 5) / 2; // хит-зона ≥ 48 CSS-px (п. 1.8)
    for (let slot = 0; slot < 3; slot++) {
      const s = layout.traySlots[slot];
      if (Math.abs(p.x - s.x) <= zone && Math.abs(p.y - s.y) <= zone) return slot;
    }
    return null;
  }

  function boardCell(p) {
    const layout = getLayout();
    const game = getGame();
    if (!game) return null;
    const cx = Math.floor((p.x - layout.boardOrigin.x) / layout.cellPx);
    const cy = Math.floor((p.y - layout.boardOrigin.y) / layout.cellPx);
    if (cx < 0 || cy < 0 || cx >= game.board.size || cy >= game.board.size) return null;
    return { x: cx, y: cy };
  }

  function evalNow(p) {
    const game = getGame();
    const layout = getLayout();
    return evaluateDrag(game.board, drag.shape, p.x, p.y, {
      cellPx: layout.cellPx,
      boardOriginPx: layout.boardOrigin,
      liftPx: drag.liftPx,
    });
  }

  function pushView(res) {
    renderer.setDrag({
      slot: drag.slot,
      shape: drag.shape,
      color: drag.color,
      originPx: res.originPx,
      target: res.target,
      valid: res.valid,
      clears: res.clears,
    });
  }

  function springBack() {
    if (!drag) return;
    const layout = getLayout();
    const slotPos = layout.traySlots[drag.slot];
    const from = drag.lastEval?.originPx
      ?? { x: slotPos.x, y: slotPos.y };
    const to = {
      x: slotPos.x - (drag.shape.w * layout.cellPx) / 2,
      y: slotPos.y - (drag.shape.h * layout.cellPx) / 2,
    };
    const snap = { slot: drag.slot, shape: drag.shape, color: drag.color };
    drag = null;
    const start = performance.now();
    returning = true;
    const tick = (now) => {
      const k = Math.min(1, (now - start) / RETURN_MS);
      const e = easeOutBack(k);
      renderer.setDrag({
        ...snap,
        originPx: { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e },
        target: null,
        valid: false,
        clears: null,
      });
      if (k < 1 && returning) requestAnimationFrame(tick);
      else {
        returning = null;
        renderer.setDrag(null);
      }
    };
    requestAnimationFrame(tick);
  }

  function cancel() { // ресайз, потеря фокуса, pointercancel — фигура не залипает
    if (drag) springBack();
  }

  canvas.addEventListener('pointerdown', (e) => {
    const game = getGame();
    const p = pos(e);
    onPointerNorm?.(p);
    if (!game || game.phase !== 'playing') return;
    if (hammerMode) {
      const cellPos = boardCell(p);
      if (cellPos) onHammerCell?.(cellPos.x, cellPos.y);
      return;
    }
    if (drag || returning) return;
    const slot = trayHit(p);
    if (slot === null || !game.tray[slot]) return;
    const layout = getLayout();
    const liftCells = e.pointerType === 'touch' ? 1.5 : 0.3; // палец не закрывает место (ТЗ 5.2)
    drag = {
      slot,
      shape: SHAPE_BY_ID[game.tray[slot].shapeId],
      color: game.tray[slot].color,
      pointerId: e.pointerId,
      liftPx: liftCells * layout.cellPx,
      lastEval: null,
    };
    // захват не критичен: без него drag просто теряется за границами канваса
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
    const res = evalNow(p);
    drag.lastEval = res;
    pushView(res);
    onLift?.();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    onPointerNorm?.(p);
    if (!drag || e.pointerId !== drag.pointerId) return;
    const res = evalNow(p);
    drag.lastEval = res;
    pushView(res);
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const res = evalNow(pos(e));
    if (res.target && res.valid) {
      const { slot } = drag;
      drag = null;
      renderer.setDrag(null);
      const ok = onPlace(slot, res.target.x, res.target.y);
      if (!ok) renderer.setDrag(null);
    } else {
      if (res.target && !res.valid) onReject?.();
      springBack();
    }
  });

  canvas.addEventListener('pointercancel', (e) => {
    if (drag && e.pointerId === drag.pointerId) cancel(); // ТЗ 5.7 — прилетает регулярно
  });

  return {
    cancel,
    setHammerMode(v) {
      hammerMode = v;
      renderer.setHammerMode(v);
      if (v) cancel();
    },
    get active() { return !!drag; },
  };
}
