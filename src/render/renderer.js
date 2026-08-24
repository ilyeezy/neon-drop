// Игровой канвас: поле, трей, drag, превью, эффекты. Логическое состояние
// применяется ядром мгновенно; здесь оно разворачивается во времени очередью
// эффектов — пока блокирующие эффекты живы, MAIN держит ядро в animating.
import { bakeSprites, rgba } from './sprites.js';
import { hexRgb } from './particles.js';
import { SPECIAL } from '../core/specials.js';
import { hasGold, isOccupied, cellIndex } from '../core/bitboard.js';
import { SHAPE_BY_ID } from '../core/shapes.js';
import { t } from '../i18n/index.js';

const GLOW = 0.3;
const BLOCKING = new Set(['place', 'clear', 'collapse']);

export function createRenderer(canvas, particles) {
  const ctx = canvas.getContext('2d');
  let layout = null;
  let theme = null;
  let sprites = null;
  let game = null;
  let effects = [];
  let popups = [];
  let shake = null;
  let fill = 0;
  let time = 0;
  let collapsed = false;
  let drag = null;
  let cursor = null;
  let hammerMode = false;
  let lastPlaceCenter = null;
  let prevStreakStep = 0;
  let unsub = [];

  const cellPx = () => layout.cellPx;
  const boardPx = () => game.board.size * layout.cellPx;

  function rebake() {
    if (layout && theme) sprites = bakeSprites(layout.cellPx, theme, layout.dpr);
  }

  function setLayout(l) {
    layout = l;
    canvas.width = Math.round(l.w * l.dpr);
    canvas.height = Math.round(l.h * l.dpr);
    canvas.style.width = `${l.w}px`;
    canvas.style.height = `${l.h}px`;
    rebake();
  }

  function setTheme(th) {
    theme = th;
    rebake();
  }

  function cellColorHex(colorIdx) {
    return theme.colors[colorIdx - 1] ?? '#ffffff';
  }

  function cellCenter(x, y) {
    return {
      x: layout.boardOrigin.x + (x + 0.5) * cellPx(),
      y: layout.boardOrigin.y + (y + 0.5) * cellPx(),
    };
  }

  function burstCells(cells, colorOf, countPer = 10, speed = 240) {
    for (const c of cells) {
      const p = cellCenter(c.x, c.y);
      particles.spawn(p.x, p.y, colorOf(c), countPer, speed, { size: cellPx() * 0.14 });
    }
  }

  function attach(nextGame) {
    for (const off of unsub) off();
    unsub = [];
    game = nextGame;
    effects = [];
    popups = [];
    shake = null;
    collapsed = false;
    drag = null;
    cursor = null;
    prevStreakStep = game ? game.streakStep : 0;
    fill = 0;
    if (!game) return;

    unsub.push(game.on('piecePlaced', ({ cells, color }) => {
      effects.push({ type: 'place', t: 0, dur: 0.18, cells, color });
      const cx = cells.reduce((a, c) => a + c[0], 0) / cells.length;
      const cy = cells.reduce((a, c) => a + c[1], 0) / cells.length;
      lastPlaceCenter = cellCenter(cx, cy);
    }));
    unsub.push(game.on('linesCleared', (ev) => {
      effects.push({ type: 'clear', t: 0, dur: 0.3, cells: ev.removedCells.map((c) => ({ x: c.x, y: c.y })) });
      burstCells(ev.removedCells, (c) => hexRgb(cellColorHex(c.color || 1)),
        ev.count >= 2 ? 14 : 9, 260);
      burstCells(ev.iceDamaged, () => [200, 240, 255], 8, 180);
      burstCells(ev.goldCleared, () => [251, 191, 36], 12, 220);
      if (ev.count >= 2) shake = { t: 0, dur: 0.14, mag: 5 };
    }));
    unsub.push(game.on('boardEmpty', () => {
      const p = cellCenter(game.board.size / 2 - 0.5, game.board.size / 2 - 0.5);
      particles.spawn(p.x, p.y, [251, 191, 36], 60, 420, { size: cellPx() * 0.16, life: 1 });
      popups.push({ text: t('perfect'), x: p.x, y: p.y, t: 0, dur: 0.9, color: '#fbbf24' });
    }));
    unsub.push(game.on('streakChanged', ({ step }) => {
      if (step > prevStreakStep && step >= 2) {
        const key = ['str_1', 'str_1', 'str_2', 'str_3'][Math.min(step - 2, 3)] ?? 'str_4';
        const word = step >= 5 ? t('str_4') : t(key);
        const p = cellCenter(game.board.size / 2 - 0.5, game.board.size * 0.35);
        popups.push({ text: `${word} ×${(step >= 1 ? [1, 1.2, 1.5, 2, 2.5, 3][Math.min(step, 5)] : 1)}`, x: p.x, y: p.y, t: 0, dur: 0.7, color: theme.accent });
      }
      prevStreakStep = step;
    }));
    unsub.push(game.on('scoreChanged', ({ delta }) => {
      if (delta > 0 && lastPlaceCenter) {
        popups.push({ text: `+${delta}`, x: lastPlaceCenter.x, y: lastPlaceCenter.y, t: 0, dur: 0.7, color: '#ffffff', small: true });
      }
    }));
    unsub.push(game.on('fillChanged', ({ ratio }) => { fill = ratio; }));
    unsub.push(game.on('gameOver', () => {
      const snapshot = [];
      const b = game.board;
      for (let y = 0; y < b.size; y++) {
        for (let x = 0; x < b.size; x++) {
          if (isOccupied(b, x, y)) {
            snapshot.push({ x, y, color: b.colors[cellIndex(b, x, y)], special: b.specials[cellIndex(b, x, y)], hp: b.specialData[cellIndex(b, x, y)] });
          }
        }
      }
      effects.push({ type: 'collapse', t: 0, dur: b.size * 0.015 + 0.55, snapshot });
      collapsed = true;
      drag = null;
      cursor = null;
    }));
    fill = 0;
  }

  function burstAt(x, y, colorIdx) { // молот и прочие точечные эффекты (зовёт session)
    const p = cellCenter(x, y);
    particles.spawn(p.x, p.y, colorIdx ? hexRgb(cellColorHex(colorIdx)) : [200, 200, 210], 14, 260, { size: cellPx() * 0.14 });
  }

  function busy() {
    return effects.some((e) => BLOCKING.has(e.type));
  }

  function drawSprite(img, x, y, scale = 1) {
    const cp = cellPx();
    const full = cp * (1 + GLOW * 2) * scale;
    const px = layout.boardOrigin.x + x * cp - cp * GLOW - (full - cp * (1 + GLOW * 2)) / 2;
    const py = layout.boardOrigin.y + y * cp - cp * GLOW - (full - cp * (1 + GLOW * 2)) / 2;
    ctx.drawImage(img, px, py, full, full);
  }

  function spriteFor(colorIdx) {
    return sprites.blocks[Math.min(colorIdx, sprites.blocks.length - 1)] ?? sprites.blocks[1];
  }

  function drawBoardFrame() {
    const cp = cellPx();
    const bp = boardPx();
    const o = layout.boardOrigin;
    let frameColor = theme.accent;
    let pulse = 0.35 + 0.1 * Math.sin(time * 2);
    if (fill > 0.9) { frameColor = '#ef4444'; pulse = 0.5 + 0.35 * Math.sin(time * 6); }
    else if (fill > 0.75) { frameColor = '#fb923c'; pulse = 0.45 + 0.25 * Math.sin(time * 4); }
    ctx.strokeStyle = rgba(frameColor, pulse);
    ctx.lineWidth = Math.max(2, cp * 0.08);
    ctx.strokeRect(o.x - cp * 0.12, o.y - cp * 0.12, bp + cp * 0.24, bp + cp * 0.24);
    // сетка
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = 0; y < game.board.size; y++) {
      for (let x = 0; x < game.board.size; x++) {
        ctx.beginPath();
        ctx.roundRect(o.x + x * cp + 1.5, o.y + y * cp + 1.5, cp - 3, cp - 3, cp * 0.14);
        ctx.fill();
      }
    }
  }

  function drawBoardBlocks() {
    const b = game.board;
    for (let y = 0; y < b.size; y++) {
      for (let x = 0; x < b.size; x++) {
        const i = cellIndex(b, x, y);
        if (hasGold(b, x, y)) drawSprite(sprites.gold, x, y);
        if (!isOccupied(b, x, y)) continue;
        const sp = b.specials[i];
        if (sp === SPECIAL.STONE) {
          drawSprite(sprites.stone, x, y);
        } else if (sp === SPECIAL.BOMB) {
          drawSprite(sprites.bomb, x, y);
          const timer = b.specialData[i];
          const p = cellCenter(x, y);
          const danger = timer <= 2;
          const alpha = danger ? 0.7 + 0.3 * Math.sin(time * 8) : 1;
          ctx.fillStyle = danger ? `rgba(248,113,113,${alpha})` : '#f9fafb';
          ctx.font = `700 ${Math.round(cellPx() * 0.5)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(timer), p.x, p.y);
        } else {
          drawSprite(spriteFor(b.colors[i]), x, y);
          if (sp === SPECIAL.ICE) drawSprite(b.specialData[i] === 2 ? sprites.ice2 : sprites.ice1, x, y);
        }
      }
    }
  }

  function drawShapeAt(shape, colorIdx, px, py, scalePx, ghost = false) {
    const img = ghost ? sprites.ghosts[colorIdx] : spriteFor(colorIdx);
    for (const [dx, dy] of shape.cells) {
      const full = scalePx * (1 + GLOW * 2);
      ctx.drawImage(img, px + dx * scalePx - scalePx * GLOW, py + dy * scalePx - scalePx * GLOW, full, full);
    }
  }

  function drawTray() {
    const cp = layout.trayCell;
    for (let slot = 0; slot < 3; slot++) {
      const piece = game.tray[slot];
      const pos = layout.traySlots[slot];
      if (!piece || (drag && drag.slot === slot)) continue;
      const shape = SHAPE_BY_ID[piece.shapeId];
      const w = shape.w * cp;
      const h = shape.h * cp;
      const px = pos.x - w / 2;
      const py = pos.y - h / 2;
      const placeableCount = game.placeable.filter(Boolean).length;
      ctx.save();
      if (!game.placeable[slot]) {
        ctx.globalAlpha = 0.4; // неразмещаемая — приглушение-подсказка (ТЗ п. 7)
      } else if (placeableCount === 1) {
        // последняя размещаемая — явный сигнал успеть с молотом до смерти
        const a = 0.5 + 0.4 * Math.sin(time * 5);
        ctx.strokeStyle = rgba(theme.accent, a);
        ctx.lineWidth = 3;
        ctx.strokeRect(pos.x - layout.trayCell * 2, pos.y - layout.trayCell * 2, layout.trayCell * 4, layout.trayCell * 4);
      }
      drawShapeAt(shape, piece.color, px, py, cp);
      ctx.restore();
    }
  }

  function drawDrag() {
    if (!drag) return;
    const cp = cellPx();
    const shape = drag.shape;
    if (drag.target) {
      const { x, y } = drag.target;
      if (drag.valid) {
        drawShapeAt(shape, drag.color, layout.boardOrigin.x + x * cp, layout.boardOrigin.y + y * cp, cp, true);
        if (drag.clears && (drag.clears.rows.length || drag.clears.cols.length)) {
          const a = 0.18 + 0.12 * Math.sin(time * 7);
          ctx.fillStyle = `rgba(255,255,255,${a})`;
          for (const ry of drag.clears.rows) ctx.fillRect(layout.boardOrigin.x, layout.boardOrigin.y + ry * cp, boardPx(), cp);
          for (const cx of drag.clears.cols) ctx.fillRect(layout.boardOrigin.x + cx * cp, layout.boardOrigin.y, cp, boardPx());
        }
      } else {
        ctx.strokeStyle = 'rgba(248,113,113,0.7)';
        ctx.lineWidth = 2;
        for (const [dx, dy] of shape.cells) {
          ctx.strokeRect(layout.boardOrigin.x + (x + dx) * cp + 2, layout.boardOrigin.y + (y + dy) * cp + 2, cp - 4, cp - 4);
        }
      }
    }
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = cp * 0.4;
    ctx.shadowOffsetY = cp * 0.25;
    drawShapeAt(shape, drag.color, drag.originPx.x, drag.originPx.y, cp);
    ctx.restore();
  }

  function drawCursor() {
    if (!cursor || drag) return;
    const cp = cellPx();
    const { shape, color, x, y, valid } = cursor;
    drawShapeAt(shape, color, layout.boardOrigin.x + x * cp, layout.boardOrigin.y + y * cp, cp, true);
    ctx.strokeStyle = valid ? rgba(theme.accent, 0.9) : 'rgba(248,113,113,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(layout.boardOrigin.x + x * cp, layout.boardOrigin.y + y * cp, shape.w * cp, shape.h * cp);
  }

  function drawEffects(dt) {
    const cp = cellPx();
    for (const e of effects) {
      e.t += dt;
      if (e.type === 'place') {
        const k = e.t / e.dur;
        const scale = k < 0.4 ? 1.15 - k * 0.575 : 0.92 + (k - 0.4) * 0.133;
        for (const [x, y] of e.cells) drawSprite(spriteFor(e.color), x, y, Math.max(0.9, scale));
      } else if (e.type === 'clear') {
        const k = e.t / e.dur;
        if (k < 0.25) {
          ctx.fillStyle = `rgba(255,255,255,${(0.8 * (1 - k / 0.25)).toFixed(3)})`;
          for (const c of e.cells) {
            ctx.beginPath();
            ctx.roundRect(layout.boardOrigin.x + c.x * cp + 1, layout.boardOrigin.y + c.y * cp + 1, cp - 2, cp - 2, cp * 0.14);
            ctx.fill();
          }
        }
      } else if (e.type === 'collapse') {
        for (const cellData of e.snapshot) {
          const delay = cellData.y * 0.015;
          const fallT = Math.max(0, e.t - delay);
          const dy = 0.5 * 2600 * fallT * fallT;
          const img = cellData.special === SPECIAL.STONE ? sprites.stone
            : cellData.special === SPECIAL.BOMB ? sprites.bomb
              : spriteFor(cellData.color);
          const full = cp * (1 + GLOW * 2);
          ctx.drawImage(img, layout.boardOrigin.x + cellData.x * cp - cp * GLOW,
            layout.boardOrigin.y + cellData.y * cp - cp * GLOW + dy, full, full);
        }
      }
    }
    effects = effects.filter((e) => e.t < e.dur);
  }

  function drawPopups(dt) {
    for (const pop of popups) {
      pop.t += dt;
      const k = pop.t / pop.dur;
      const scale = k < 0.25 ? 0.5 + k * 2.6 : k < 0.45 ? 1.15 - (k - 0.25) * 0.75 : 1;
      const alpha = k > 0.55 ? 1 - (k - 0.55) / 0.45 : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(pop.x, pop.y - k * cellPx() * 0.8);
      ctx.scale(scale, scale);
      ctx.font = `800 ${Math.round(cellPx() * (pop.small ? 0.42 : 0.62))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 4;
      ctx.strokeText(pop.text, 0, 0);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, 0, 0);
      ctx.restore();
    }
    popups = popups.filter((pop) => pop.t < pop.dur);
  }

  function step(dt) {
    if (!layout || !theme) return;
    time += dt;
    ctx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);
    ctx.clearRect(0, 0, layout.w, layout.h);
    if (!game || !sprites) return;

    ctx.save();
    if (shake) {
      shake.t += dt;
      if (shake.t >= shake.dur) shake = null;
      else {
        const m = shake.mag * (1 - shake.t / shake.dur);
        ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
      }
    }
    drawBoardFrame();
    if (!collapsed) drawBoardBlocks();
    drawEffects(dt);
    particles.step(dt);
    particles.draw(ctx);
    if (!collapsed) {
      drawTray();
      drawDrag();
      drawCursor();
      if (hammerMode) {
        ctx.strokeStyle = rgba(theme.accent, 0.5 + 0.3 * Math.sin(time * 5));
        ctx.lineWidth = 3;
        ctx.strokeRect(layout.boardOrigin.x - 4, layout.boardOrigin.y - 4, boardPx() + 8, boardPx() + 8);
      }
    }
    drawPopups(dt);
    ctx.restore();
  }

  return {
    setLayout,
    setTheme,
    attach,
    step,
    busy,
    burstAt,
    setDrag(d) { drag = d; },
    setCursor(c) { cursor = c; },
    setHammerMode(v) { hammerMode = v; },
    get theme() { return theme; },
  };
}
