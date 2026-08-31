// Адаптивный лейаут: активная область по вертикали до краёв, ширина не
// длиннее 2:1 (п. 1.6.2.1/2); клетка = floor(min(...)), поле центрируется,
// ничего не растягивается. Слушает и visualViewport.resize — sticky-баннер
// сжимает вьюпорт, вёрстка обязана пережить (п. 1.10.1/1.10.3).
const HUD_H = 56;
const PAD = 10;
const BOOSTER_BAR = 60;   // полоса бустеров: своя зона, трей на неё не заезжает
const MAX_CELL = 62;      // потолок клетки: на большом экране поле не растягивается во всю высоту

export function createLayout({ stageEl, onChange }) {
  let metrics = null;
  let gameSize = 8;
  let timer = null;

  function compute() {
    const vv = window.visualViewport;
    // в iframe и на скрытых вкладках размеры приходят нулями — считать по ним
    // нельзя: получится вырожденный лейаут с портретной раскладкой
    const vw = Math.max(320, Math.floor(vv ? vv.width : window.innerWidth) || 0);
    const vh = Math.max(480, Math.floor(vv ? vv.height : window.innerHeight) || 0);
    const stageH = vh;
    const stageW = Math.min(vw, stageH * 2); // соотношение активной области ≤ 2:1
    const portrait = stageH >= stageW * 0.95;
    const size = gameSize;
    const safeBottom = 8;
    let cellPx;
    let boardOrigin;
    let traySlots;
    let trayCell;
    let boosterBar;

    if (portrait) {
      // снизу вверх: безопасная зона → бустеры → трей → поле → HUD.
      // Каждая зона получает свою высоту, поэтому фигуры трея физически не
      // могут оказаться поверх кнопок бустеров.
      const trayH = Math.max(88, Math.min(140, Math.floor(stageH * 0.16)));
      const availW = stageW - PAD * 2;
      const availH = stageH - HUD_H - trayH - BOOSTER_BAR - safeBottom - PAD * 2;
      cellPx = Math.max(8, Math.min(MAX_CELL, Math.floor(Math.min(availW / size, availH / size))));
      const bp = cellPx * size;
      boardOrigin = {
        x: Math.floor((stageW - bp) / 2),
        y: HUD_H + PAD + Math.floor(Math.max(0, availH - bp) / 2),
      };
      const trayTop = stageH - safeBottom - BOOSTER_BAR - trayH;
      trayCell = Math.min(Math.floor(cellPx * 0.62), Math.floor((stageW - PAD * 2) / 15));
      const ty = trayTop + Math.floor(trayH / 2);
      traySlots = [0, 1, 2].map((i) => ({
        x: Math.floor(stageW / 2 + (i - 1) * (stageW / 3.2)),
        y: ty,
      }));
      boosterBar = { left: PAD, right: PAD, bottom: safeBottom, height: BOOSTER_BAR, row: true };
    } else {
      // ландшафт: трей колонкой справа, бустеры колонкой слева — зоны по краям
      const trayW = Math.max(100, Math.min(180, Math.floor(stageW * 0.18)));
      const boosterW = 76;
      const availW = stageW - trayW - boosterW - PAD * 3;
      const availH = stageH - HUD_H - PAD * 2;
      cellPx = Math.max(8, Math.min(MAX_CELL, Math.floor(Math.min(availW / size, availH / size))));
      const bp = cellPx * size;
      boardOrigin = {
        x: boosterW + PAD + Math.floor(Math.max(0, availW - bp) / 2),
        y: HUD_H + PAD + Math.floor(Math.max(0, availH - bp) / 2),
      };
      trayCell = Math.min(Math.floor(cellPx * 0.62), Math.floor(trayW / 5.5));
      const tx = stageW - Math.floor(trayW / 2);
      traySlots = [0, 1, 2].map((i) => ({ x: tx, y: Math.floor(stageH / 2 + (i - 1) * (stageH / 4)) }));
      boosterBar = { left: PAD, bottom: PAD, width: boosterW, height: null, row: false };
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
      boosterBar,
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
