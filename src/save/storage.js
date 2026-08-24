// Схема сейва, версия, миграции и политика записи. Транспорт (SDK + зеркало
// localStorage) — сегмент PLAT; здесь решается «что и когда», там — «куда».
export const SAVE_SCHEMA_VERSION = 2;

// @spec SAVE-SCH-001
export function defaultSave(now = 0) {
  return {
    version: SAVE_SCHEMA_VERSION,
    timestamp: now,
    settings: { sound: true, music: true, lang: null, fairMode: false },
    records: { classic: 0, big: 0, fairClassic: 0, fairBig: 0 },
    daily: { lastDate: null, playedToday: false, secondAttemptUsed: false, rvSecond: false, streakDays: 0, best: 0 },
    progress: { levels: [], themes: ['neon'], activeTheme: 'neon', tutorialDone: false },
    stats: { bestScore: 0, maxStreak: 0, boardsCleared: 0, levelsDone: 0 },
    boosters: { hammer: 3, shuffle: 3, undo: 3 },
    boostersRefilledOn: null, // дата последней ежедневной дозаправки
    currentRun: null,
  };
}

// Цепочка миграций v → v+1; будущая версия не интерпретируется (SAVE-SCH-003).
const MIGRATIONS = {
  // v1 не знал про ежедневную дозаправку бустеров
  1: (save) => ({ ...save, boostersRefilledOn: null }),
};

// @spec SAVE-SCH-003
export function migrate(save, now = 0) {
  if (!save || typeof save.version !== 'number') return defaultSave(now);
  if (save.version > SAVE_SCHEMA_VERSION) return defaultSave(now);
  let cur = save;
  while (cur.version < SAVE_SCHEMA_VERSION) {
    const step = MIGRATIONS[cur.version];
    if (!step) return defaultSave(now);
    cur = { ...step(cur), version: cur.version + 1 };
  }
  return cur;
}

export function parseSave(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || typeof obj.version !== 'number'
      || typeof obj.timestamp !== 'number' || !obj.settings || !obj.records) return null;
    return obj;
  } catch {
    return null;
  }
}

// @spec SAVE-SCH-002
export function pickFresher(a, b) {
  if (!a) return b;
  if (!b) return a;
  return b.timestamp > a.timestamp ? b : a;
}

// Менеджер: двойное чтение/запись, дебаунс. Всё внешнее инжектится.
// @spec SAVE-SCH-004, SAVE-SCH-005
export function createSaveManager({ platform, mirror, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let data = defaultSave(now());
  let timer = null;

  async function load() {
    const remote = parseSave(await platform.loadRaw());
    const local = parseSave(mirror.load());
    const chosen = pickFresher(remote, local);
    data = migrate(chosen ?? defaultSave(now()), now());
    return data;
  }

  function writeNow(flush) {
    data.timestamp = now();
    const str = JSON.stringify(data);
    mirror.save(str); // локальная запись не зависит от исхода SDK
    Promise.resolve(platform.saveRaw(str, flush)).catch(() => {});
  }

  // Критичные события — немедленно с flush; настройки/автосейв — дебаунс 2 с.
  function commit(critical = false) {
    if (critical) {
      if (timer) { clearTimer(timer); timer = null; }
      writeNow(true);
      return;
    }
    if (timer) clearTimer(timer);
    timer = setTimer(() => { timer = null; writeNow(false); }, 2000);
  }

  return {
    load,
    commit,
    get data() { return data; },
  };
}
