// Заглушка платформы для локальной разработки: транспорт — инжектируемое
// хранилище, реклама — мгновенный успешный путь, платформенных пауз нет.
// @spec PLAT-API-001, PLAT-API-002, PLAT-API-003, PLAT-API-004
const SAVE_KEY = 'gp_save';

export function createStubPlatform({ storage, lang } = {}) {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : new Map());
  const get = (k) => (store instanceof Map ? store.get(k) ?? null : store.getItem(k));
  const set = (k, v) => (store instanceof Map ? store.set(k, v) : store.setItem(k, v));
  const detectedLang = lang
    ?? (typeof navigator !== 'undefined' && navigator.language?.startsWith('ru') ? 'ru' : 'en');

  return {
    isStub: true,
    ready() {},
    gameplayStart() {},
    gameplayStop() {},
    getLang: () => detectedLang,
    async loadRaw() {
      try { return get(SAVE_KEY); } catch { return null; }
    },
    async saveRaw(str) {
      try { set(SAVE_KEY, str); return true; } catch { return false; }
    },
    showInterstitial({ onOpen, onClose } = {}) {
      onOpen?.();
      onClose?.(true);
    },
    showRewarded({ onOpen, onRewarded, onClose } = {}) {
      onOpen?.();
      onRewarded?.();
      onClose?.();
    },
    onPause() {},
    onResume() {},
  };
}
