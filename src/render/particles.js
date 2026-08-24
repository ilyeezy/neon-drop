// Пул частиц на типизированных массивах: ноль аллокаций в кадре (ТЗ п. 7).
// Исчерпание пула молча переиспользует старейшие слоты.
const CAP = 2048;

export function createParticles() {
  const x = new Float32Array(CAP);
  const y = new Float32Array(CAP);
  const vx = new Float32Array(CAP);
  const vy = new Float32Array(CAP);
  const life = new Float32Array(CAP); // остаток жизни, сек; 0 = слот свободен
  const total = new Float32Array(CAP);
  const size = new Float32Array(CAP);
  const cr = new Uint8Array(CAP);
  const cg = new Uint8Array(CAP);
  const cb = new Uint8Array(CAP);
  let cursor = 0;
  let multiplier = 1; // деградация: пробник FPS может уполовинить

  function spawn(px, py, rgb, count, speed, opts = {}) {
    const n = Math.max(1, Math.round(count * multiplier));
    for (let k = 0; k < n; k++) {
      const i = cursor;
      cursor = (cursor + 1) % CAP;
      const ang = opts.angle ?? Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      x[i] = px;
      y[i] = py;
      vx[i] = Math.cos(ang) * v + (opts.vx ?? 0);
      vy[i] = Math.sin(ang) * v + (opts.vy ?? 0);
      total[i] = life[i] = (opts.life ?? 0.7) * (0.7 + Math.random() * 0.6);
      size[i] = (opts.size ?? 4) * (0.6 + Math.random() * 0.8);
      cr[i] = rgb[0]; cg[i] = rgb[1]; cb[i] = rgb[2];
    }
  }

  function step(dt) {
    for (let i = 0; i < CAP; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      vy[i] += 620 * dt; // гравитация
      vx[i] *= 0.985;
    }
  }

  function draw(ctx) {
    for (let i = 0; i < CAP; i++) {
      if (life[i] <= 0) continue;
      const a = Math.max(0, life[i] / total[i]);
      ctx.fillStyle = `rgba(${cr[i]},${cg[i]},${cb[i]},${a})`;
      const s = size[i] * (0.5 + a * 0.5);
      ctx.fillRect(x[i] - s / 2, y[i] - s / 2, s, s);
    }
  }

  return {
    spawn,
    step,
    draw,
    setMultiplier(m) { multiplier = m; },
  };
}

export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
