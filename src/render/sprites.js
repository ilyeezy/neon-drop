// Пре-рендер блоков в offscreen canvas: свечение и фаски запекаются здесь,
// в кадре — только drawImage (ТЗ п. 7 «Производительность»). Перезапекается
// на ресайз и смену темы.
const GLOW = 0.3; // поля вокруг блока под запечённое свечение, доля клетки

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

function shade(hex, k) { // k > 0 — светлее, k < 0 — темнее
  const [r, g, b] = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (k > 0 ? (255 - v) * k : v * k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function makeCanvas(px) {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBlock(ctx, px, margin, color, { ghost = false, glowColor = color } = {}) {
  const size = px - margin * 2;
  const r = size * 0.18;
  const x = margin;
  const y = margin;
  ctx.save();
  if (!ghost) {
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = margin * 0.9; // запекается один раз — не в кадре
  }
  const grad = ctx.createLinearGradient(0, y, 0, y + size);
  grad.addColorStop(0, shade(color, 0.35));
  grad.addColorStop(1, shade(color, -0.15));
  ctx.fillStyle = ghost ? rgba(color, 0.12) : grad;
  roundRect(ctx, x, y, size, size, r);
  ctx.fill();
  ctx.shadowBlur = 0;
  // фаска: светлая сверху-слева, тёмная снизу-справа
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.strokeStyle = ghost ? rgba(color, 0.5) : rgba('#ffffff', 0.35);
  ctx.beginPath();
  ctx.moveTo(x + r, y + ctx.lineWidth / 2);
  ctx.lineTo(x + size - r, y + ctx.lineWidth / 2);
  ctx.stroke();
  if (!ghost) {
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.moveTo(x + r, y + size - ctx.lineWidth / 2);
    ctx.lineTo(x + size - r, y + size - ctx.lineWidth / 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawIce(ctx, px, margin, hp) {
  const size = px - margin * 2;
  ctx.save();
  ctx.fillStyle = hp === 2 ? 'rgba(165,225,255,0.55)' : 'rgba(165,225,255,0.35)';
  roundRect(ctx, margin, margin, size, size, size * 0.18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(220,245,255,0.8)';
  ctx.lineWidth = Math.max(1, size * 0.05);
  roundRect(ctx, margin, margin, size, size, size * 0.18);
  ctx.stroke();
  // трещины: hp1 — глубокие
  ctx.strokeStyle = hp === 2 ? 'rgba(255,255,255,0.5)' : 'rgba(30,80,120,0.8)';
  ctx.lineWidth = Math.max(1, size * (hp === 2 ? 0.03 : 0.05));
  ctx.beginPath();
  ctx.moveTo(margin + size * 0.25, margin + size * 0.2);
  ctx.lineTo(margin + size * 0.5, margin + size * 0.55);
  ctx.lineTo(margin + size * 0.35, margin + size * 0.85);
  if (hp === 1) {
    ctx.moveTo(margin + size * 0.75, margin + size * 0.15);
    ctx.lineTo(margin + size * 0.55, margin + size * 0.5);
    ctx.lineTo(margin + size * 0.8, margin + size * 0.8);
  }
  ctx.stroke();
  ctx.restore();
}

function drawStone(ctx, px, margin) {
  const size = px - margin * 2;
  ctx.save();
  const grad = ctx.createLinearGradient(0, margin, 0, margin + size);
  grad.addColorStop(0, '#7b8494');
  grad.addColorStop(1, '#4b5563');
  ctx.fillStyle = grad; // матовый, без свечения
  roundRect(ctx, margin, margin, size, size, size * 0.18);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (const [fx, fy, fr] of [[0.3, 0.35, 0.1], [0.65, 0.6, 0.13], [0.5, 0.25, 0.06]]) {
    ctx.beginPath();
    ctx.arc(margin + size * fx, margin + size * fy, size * fr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBomb(ctx, px, margin) {
  const size = px - margin * 2;
  const c = margin + size / 2;
  ctx.save();
  ctx.shadowColor = '#f87171';
  ctx.shadowBlur = margin * 0.6;
  const grad = ctx.createRadialGradient(c - size * 0.15, c - size * 0.15, size * 0.1, c, c, size * 0.5);
  grad.addColorStop(0, '#4b3040');
  grad.addColorStop(1, '#180b12');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.44, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGold(ctx, px, margin) {
  const size = px - margin * 2;
  ctx.save();
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.shadowColor = '#fbbf24';
  ctx.shadowBlur = margin * 0.8;
  roundRect(ctx, margin + size * 0.08, margin + size * 0.08, size * 0.84, size * 0.84, size * 0.16);
  ctx.stroke();
  ctx.restore();
}

// Спрайты на все состояния: цвет × (обычный | призрак), спецблоки, золото.
export function bakeSprites(cellPx, theme, dpr) {
  const px = Math.round(cellPx * (1 + GLOW * 2) * dpr);
  const margin = Math.round(cellPx * GLOW * dpr);
  const bake = (draw) => {
    const c = makeCanvas(px);
    draw(c.getContext('2d'));
    return c;
  };
  const blocks = [null];
  const ghosts = [null];
  for (const color of theme.colors) {
    blocks.push(bake((ctx) => drawBlock(ctx, px, margin, color)));
    ghosts.push(bake((ctx) => drawBlock(ctx, px, margin, color, { ghost: true })));
  }
  return {
    px, margin, dpr,
    blocks,
    ghosts,
    ice2: bake((ctx) => drawIce(ctx, px, margin, 2)),
    ice1: bake((ctx) => drawIce(ctx, px, margin, 1)),
    stone: bake((ctx) => drawStone(ctx, px, margin)),
    bomb: bake((ctx) => drawBomb(ctx, px, margin)),
    gold: bake((ctx) => drawGold(ctx, px, margin)),
  };
}
