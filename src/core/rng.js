// Детерминированный PRNG партии (mulberry32). Всё состояние — одно 32-битное
// число, поэтому оно целиком входит в снапшоты undo и в сейв (инварианты
// детерминизма CORE, см. docs/intent/core/core-design.md).
// @spec CORE-DET-001
export function createRng(seed) {
  let state = (seed ?? 1) >>> 0;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    int: (n) => Math.floor(next() * n),
    getState: () => state,
    setState: (s) => { state = s >>> 0; },
  };
}
