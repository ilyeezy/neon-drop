// Политика interstitial: только экран результата, не чаще раза в 180 с,
// не в первой партии сессии (ТЗ раздел 10, п. 4.4). Время инжектится.
// @spec PLAT-ADS-001, PLAT-ADS-002
const COOLDOWN_MS = 180000;

export function createAdPolicy() {
  let gamesFinished = 0;
  let lastShownAt = -Infinity;
  return {
    markGameFinished() { gamesFinished += 1; },
    shouldShow(now) {
      return gamesFinished >= 2 && now - lastShownAt >= COOLDOWN_MS;
    },
    markShown(now) { lastShownAt = now; },
  };
}
