// Клавиатурная схема (ТЗ п. 5): только event.code, без Ctrl/Alt/Meta и
// F-клавиш, preventDefault на стрелках и пробеле. Даёт доступность и
// закрывает клавиатурные среды.
import { canPlace } from '../core/bitboard.js';
import { linesAfterPlace } from './drag-logic.js';
import { SHAPE_BY_ID } from '../core/shapes.js';

export function createKeyboardInput({ getGame, renderer, onPlace, onPause, onCancel, isGameVisible }) {
  let slot = null;
  let cx = 0;
  let cy = 0;

  function reset() {
    slot = null;
    renderer.setCursor(null);
  }

  function refresh() {
    const game = getGame();
    if (slot === null || !game || !game.tray[slot]) {
      renderer.setCursor(null);
      return;
    }
    const shape = SHAPE_BY_ID[game.tray[slot].shapeId];
    cx = Math.min(cx, game.board.size - shape.w);
    cy = Math.min(cy, game.board.size - shape.h);
    const valid = canPlace(game.board, shape, cx, cy);
    renderer.setCursor({
      shape,
      color: game.tray[slot].color,
      x: cx,
      y: cy,
      valid,
      clears: valid ? linesAfterPlace(game.board, shape, cx, cy) : null,
    });
  }

  function selectSlot(next) {
    const game = getGame();
    if (!game || !game.tray[next]) return;
    slot = next;
    refresh();
  }

  document.addEventListener('keydown', (e) => {
    const game = getGame();
    if (!game || !isGameVisible()) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return; // системные сочетания не трогаем
    switch (e.code) {
      case 'Digit1': case 'Digit2': case 'Digit3':
        selectSlot(Number(e.code.slice(-1)) - 1);
        break;
      case 'Tab': {
        e.preventDefault();
        for (let step = 1; step <= 3; step++) {
          const next = ((slot ?? -1) + step) % 3;
          if (game.tray[next]) { selectSlot(next); break; }
        }
        break;
      }
      case 'ArrowLeft': e.preventDefault(); if (slot !== null) { cx -= 1; cx = Math.max(0, cx); refresh(); } break;
      case 'ArrowRight': e.preventDefault(); if (slot !== null) { cx += 1; refresh(); } break;
      case 'ArrowUp': e.preventDefault(); if (slot !== null) { cy -= 1; cy = Math.max(0, cy); refresh(); } break;
      case 'ArrowDown': e.preventDefault(); if (slot !== null) { cy += 1; refresh(); } break;
      case 'Enter': case 'Space': {
        if (slot === null) break;
        e.preventDefault();
        const shape = SHAPE_BY_ID[game.tray[slot].shapeId];
        if (canPlace(game.board, shape, cx, cy)) {
          const placed = slot;
          onPlace(placed, cx, cy);
          if (!game.tray[placed]) slot = null;
          refresh();
        }
        break;
      }
      case 'Escape': reset(); onCancel?.(); break;
      case 'KeyP': onPause(); break;
      default: break;
    }
  });

  return { reset, refresh };
}
