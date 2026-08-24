// Адаптивный лейаут: активная область по вертикали до краёв, ширина не
// длиннее 2:1 (п. 1.6.2.1/2); клетка = floor(min(...)), поле центрируется,
// ничего не растягивается. Слушает и visualViewport.resize — sticky-баннер
// сжимает вьюпорт, вёрстка обязана пережить (п. 1.10.1/1.10.3).
const HUD_H = 60;
const PAD = 10;

export function createLayout({ stageEl, onChange }) {
  let metrics = null;
  let gameSize = 8;
  let timer = null;

  function compute() {
    const vv = window.visualViewport;
    const vw = Math.floor(vv ? vv.width : window.innerWidth);
    const vh = Math.floor(vv ? vv.height : window.innerHeight);
    const stageH = vh;
    const stageW = Math.min(vw, stageH * 2); // соотношение активной области ≤ 2:1
    const portrait = stageH >= stageW * 0.95;
    const size = gameSize;
    let cellPx;
    let boardOrigin;
    let traySlots;
    let trayCell;

    if (portrait) {
      const trayH = Math.max(84, Math.min(150, Math.floor(stageH * 0.19)));
      const availW = stageW - PAD * 2;
      const availH = stageH - HUD_H - trayH - PAD * 2;
      cellPx = Math.max(8, Math.floor(Math.min(availW / size, availH / size)));
      const bp = cellPx * size;
      boardOrigin = {
        x: Math.floor((stageW - bp) / 2),
        y: HUD_H + PAD + Math.floor(Math.max(0, availH - bp) / 2),
      };
      trayCell = Math.min(Math.floor(cellPx * 0.6), Math.floor((stageW - PAD * 2) / 16));
      const ty = stageH - Math.floor(trayH / 2);
      traySlots = [0, 1, 2].map((i) => ({ x: Math.floor(stageW / 2 + (i - 1) * (stageW / 3.1)), y: ty }));
    } else {
      const trayW = Math.max(96, Math.min(190, Math.floor(stageW * 0.2)));
      const availW = stageW - trayW - PAD * 3;
      const availH = stageH - HUD_H - PAD * 2;
      cellPx = Math.max(8, Math.floor(Math.min(availW / size, availH / size)));
      const bp = cellPx * size;
      boardOrigin = {
        x: PAD + Math.floor(Math.max(0, availW - bp) / 2),
        y: HUD_H + PAD + Math.floor(Math.max(0, availH - bp) / 2),
      };
      trayCell = Math.min(Math.floor(cellPx * 0.6), Math.floor(trayW / 6));
      const tx = stageW - Math.floor(trayW / 2);
      traySlots = [0, 1, 2].map((i) => ({ x: tx, y: Math.floor(stageH / 2 + (i - 1) * (stageH / 4.2)) }));
    }

    metrics = {
      w: stageW,
      h: stageH,
      dpr: Math.min(2, window.devicePixelRatio || 1),
      cellPx,
      boardOrigin,
      traySlots,
      trayCell,
      portrait,
    };
    stageEl.style.width = `${stageW}px`;
    stageEl.style.height = `${stageH}px`;
    stageEl.style.left = `${Math.floor((vw - stageW) / 2)}px`;
    return metrics;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      compute();
      onChange?.(metrics);
    }, 100); // дебаунс ресайза (ТЗ п. 8)
  }

  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);

  compute();
  return {
    get metrics() { return metrics; },
    // смена размера поля — не «ресайз окна»: onChange не дёргаем,
    // вызывающий сам применяет метрики (иначе старт партии уходил бы в автопаузу)
    setGameSize(n) {
      if (n !== gameSize) {
        gameSize = n;
        compute();
      }
      return metrics;
    },
    recompute() {
      compute();
      return metrics;
    },
  };
}
