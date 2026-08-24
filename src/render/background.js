// Анимированный фон: градиент, туманности, два слоя звёздной пыли с лёгким
// параллаксом. Рисуется через кадр — дрейф медленный, полного FPS не требует.
import { rgba } from './sprites.js';

export function createBackground(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let t = 0;
  let frame = 0;
  let theme = null;
  let stars = [[], []];
  let parX = 0;
  let parY = 0;

  function resize(width, height, dpr) {
    w = Math.round(width * dpr);
    h = Math.round(height * dpr);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    stars = [0, 1].map((layer) => Array.from({ length: layer ? 70 : 40 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: (layer ? 1 : 1.8) * (0.6 + Math.random()) * (dpr),
      a: 0.25 + Math.random() * 0.5,
      tw: Math.random() * Math.PI * 2,
    })));
    frame = 0; // форс перерисовки
  }

  function setTheme(th) {
    theme = th;
    frame = 0;
  }

  function setParallax(nx, ny) { // −1..1 от указателя / дрейфа фигуры
    parX = nx;
    parY = ny;
  }

  function step(dt) {
    t += dt;
    frame += 1;
    if (frame % 2 === 0 || !theme) return; // через кадр
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, theme.bg[0]);
    grad.addColorStop(1, theme.bg[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // туманности
    for (let i = 0; i < 3; i++) {
      const cx = w * (0.2 + 0.3 * i) + Math.sin(t * 0.05 + i * 2.1) * w * 0.08;
      const cy = h * (0.25 + 0.25 * i) + Math.cos(t * 0.04 + i) * h * 0.06;
      const r = Math.max(w, h) * 0.28;
      const neb = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      neb.addColorStop(0, rgba(theme.accent, 0.07));
      neb.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = neb;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    // звёзды, два слоя параллакса
    for (let layer = 0; layer < 2; layer++) {
      const k = layer ? 8 : 16;
      for (const s of stars[layer]) {
        const a = s.a * (0.7 + 0.3 * Math.sin(t * 1.3 + s.tw));
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x + parX * k, s.y + parY * k, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return { resize, setTheme, setParallax, step };
}
