import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refillDailyBoosters, BOOSTER_DAILY_MIN } from '../src/content/progress.js';
import { defaultSave, migrate, SAVE_SCHEMA_VERSION } from '../src/save/storage.js';

const TODAY = '20260824';
const TOMORROW = '20260825';

test('дозаправка добирает пустой запас до дневного минимума', () => {
  const save = defaultSave(1);
  save.boosters = { hammer: 0, shuffle: 1, undo: 0 };
  assert.equal(refillDailyBoosters(save, TODAY), true);
  assert.deepEqual(save.boosters, BOOSTER_DAILY_MIN);
  assert.equal(save.boostersRefilledOn, TODAY);
});

// Награда за rewarded даёт сверх минимума — добор не должен её срезать,
// иначе просмотр рекламы обесценивался бы к следующему дню.
test('избыток сверх минимума сохраняется', () => {
  const save = defaultSave(1);
  save.boosters = { hammer: 7, shuffle: 0, undo: 4 };
  refillDailyBoosters(save, TODAY);
  assert.deepEqual(save.boosters, { hammer: 7, shuffle: 3, undo: 4 });
});

test('в тот же день повторная дозаправка не срабатывает', () => {
  const save = defaultSave(1);
  refillDailyBoosters(save, TODAY);
  save.boosters.hammer = 0; // потратили за день
  assert.equal(refillDailyBoosters(save, TODAY), false);
  assert.equal(save.boosters.hammer, 0, 'внутри дня запас не восстанавливается');
});

test('в новый день запас снова добирается', () => {
  const save = defaultSave(1);
  refillDailyBoosters(save, TODAY);
  save.boosters = { hammer: 0, shuffle: 0, undo: 0 };
  assert.equal(refillDailyBoosters(save, TOMORROW), true);
  assert.deepEqual(save.boosters, BOOSTER_DAILY_MIN);
  assert.equal(save.boostersRefilledOn, TOMORROW);
});

// @spec SAVE-SCH-003
test('миграция v1 → v2 добавляет поле дозаправки и сохраняет прогресс', () => {
  const v1 = {
    ...defaultSave(5), version: 1, records: { classic: 4200, big: 0, fairClassic: 0, fairBig: 0 },
  };
  delete v1.boostersRefilledOn;
  const migrated = migrate(v1, 9);
  assert.equal(migrated.version, SAVE_SCHEMA_VERSION);
  assert.equal(migrated.records.classic, 4200, 'старый прогресс не потерян');
  assert.equal(migrated.boostersRefilledOn, null);
  assert.equal(refillDailyBoosters(migrated, TODAY), true, 'после миграции дозаправка работает');
});
