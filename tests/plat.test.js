import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStubPlatform } from '../src/platform/stub.js';
import { initPlatform } from '../src/platform/yandex.js';
import { createAdPolicy } from '../src/platform/ads-policy.js';

const IFACE = ['ready', 'gameplayStart', 'gameplayStop', 'getLang', 'loadRaw', 'saveRaw',
  'showInterstitial', 'showRewarded', 'onPause', 'onResume'];

// @spec PLAT-API-001
test('единый интерфейс; без YaGames инициализация даёт заглушку', async () => {
  const platform = await initPlatform(); // в Node YaGames нет
  assert.equal(platform.isStub, true);
  for (const key of IFACE) assert.equal(typeof platform[key], 'function', key);
  const stub = createStubPlatform({ storage: new Map(), lang: 'ru' });
  for (const key of IFACE) assert.equal(typeof stub[key], 'function', key);
  assert.equal(stub.getLang(), 'ru');
});

// @spec PLAT-API-002
test('транспорт заглушки: round-trip через инжектированное хранилище', async () => {
  const storage = new Map();
  const stub = createStubPlatform({ storage });
  assert.equal(await stub.loadRaw(), null);
  assert.equal(await stub.saveRaw('{"a":1}'), true);
  assert.equal(await stub.loadRaw(), '{"a":1}');
});

// @spec PLAT-API-003
test('реклама заглушки: мгновенный успешный путь, onError не зовётся', () => {
  const stub = createStubPlatform({ storage: new Map() });
  const log = [];
  stub.showInterstitial({
    onOpen: () => log.push('open'),
    onClose: (shown) => log.push(`close:${shown}`),
    onError: () => log.push('error'),
  });
  stub.showRewarded({
    onOpen: () => log.push('rvOpen'),
    onRewarded: () => log.push('reward'),
    onClose: () => log.push('rvClose'),
    onError: () => log.push('rvError'),
  });
  assert.deepEqual(log, ['open', 'close:true', 'rvOpen', 'reward', 'rvClose']);
});

// @spec PLAT-API-004
test('ошибки транспорта не выходят исключениями', async () => {
  const broken = {
    getItem() { throw new Error('quota'); },
    setItem() { throw new Error('quota'); },
  };
  const stub = createStubPlatform({ storage: broken });
  assert.equal(await stub.loadRaw(), null);
  assert.equal(await stub.saveRaw('x'), false);
});

// @spec PLAT-ADS-001, PLAT-ADS-002
test('interstitial: не первая партия и кулдаун 180 с', () => {
  const policy = createAdPolicy();
  assert.equal(policy.shouldShow(0), false); // партий ещё не было
  policy.markGameFinished();
  assert.equal(policy.shouldShow(1000), false); // первая партия сессии — нельзя
  policy.markGameFinished();
  assert.equal(policy.shouldShow(2000), true);
  policy.markShown(2000);
  policy.markGameFinished();
  assert.equal(policy.shouldShow(2000 + 179000), false); // кулдаун не вышел
  assert.equal(policy.shouldShow(2000 + 180000), true);
});
