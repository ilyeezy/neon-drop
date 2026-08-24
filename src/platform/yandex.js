// Обёртка над SDK Яндекс Игр. Игровой код зовёт только этот интерфейс;
// при отсутствии YaGames возвращается заглушка — локальная разработка
// идёт тем же путём (ТЗ раздел 10).
// @spec PLAT-API-001, PLAT-API-004
import { createStubPlatform } from './stub.js';

const LS_KEY = 'gp_save';

export async function initPlatform() {
  if (typeof YaGames === 'undefined') return createStubPlatform();
  let ysdk = null;
  try {
    ysdk = await YaGames.init();
    window.ysdk = ysdk;
  } catch (e) {
    console.warn('SDK init failed', e);
    return createStubPlatform();
  }

  let player = null;
  const getPlayer = async () => {
    if (player) return player;
    try {
      player = await ysdk.getPlayer({ scopes: false }); // гостевой вход, без диалога (п. 1.2.2)
    } catch { player = null; }
    return player;
  };

  const pauseHandlers = [];
  const resumeHandlers = [];
  ysdk.on?.('game_api_pause', () => pauseHandlers.forEach((fn) => fn()));
  ysdk.on?.('game_api_resume', () => resumeHandlers.forEach((fn) => fn()));

  return {
    isStub: false,
    ready() {
      ysdk.features?.LoadingAPI?.ready?.();
    },
    gameplayStart() {
      ysdk.features?.GameplayAPI?.start?.();
    },
    gameplayStop() {
      ysdk.features?.GameplayAPI?.stop?.();
    },
    getLang() {
      return ysdk.environment?.i18n?.lang ?? 'en';
    },
    async loadRaw() {
      const p = await getPlayer();
      if (!p) return null;
      try {
        const data = await p.getData(['save']);
        return typeof data?.save === 'string' ? data.save : null;
      } catch { return null; }
    },
    async saveRaw(str, flush = false) {
      const p = await getPlayer();
      if (!p) return false;
      try {
        await p.setData({ save: str }, flush);
        return true;
      } catch { return false; }
    },
    showInterstitial(callbacks = {}) {
      ysdk.adv?.showFullscreenAdv?.({ callbacks });
    },
    showRewarded(callbacks = {}) {
      ysdk.adv?.showRewardedVideo?.({ callbacks });
    },
    onPause(fn) { pauseHandlers.push(fn); },
    onResume(fn) { resumeHandlers.push(fn); },
  };
}

// Локальное зеркало сейва — второй транспорт (читает/пишет SAVE).
export const localMirror = {
  load() {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null; } catch { return null; }
  },
  save(str) {
    try {
      if (typeof localStorage !== 'undefined') { localStorage.setItem(LS_KEY, str); return true; }
      return false;
    } catch { return false; }
  },
};
