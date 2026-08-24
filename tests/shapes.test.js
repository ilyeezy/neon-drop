import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, SHAPE_BY_ID } from '../src/core/shapes.js';

// @spec CORE-SHAPE-001
test('каталог: 37 фигур, состав категорий, без дублей форм', () => {
  assert.equal(SHAPES.length, 37);
  const count = (re) => SHAPES.filter((s) => re.test(s.id)).length;
  assert.equal(count(/^P1$/), 1);
  assert.equal(count(/^I[2345][HV]$/), 8);
  assert.equal(count(/^SQ[23]$/), 2);
  assert.equal(count(/^R(23|32)$/), 2);
  assert.equal(count(/^C3_\d$/), 4);
  assert.equal(count(/^C5_\d$/), 4);
  assert.equal(count(/^T4_\d$/), 4);
  assert.equal(count(/^[SZ]4_\d$/), 4);
  assert.equal(count(/^[JL]4_\d$/), 8);
  assert.equal(new Set(SHAPES.map((s) => s.id)).size, 37);
  assert.equal(new Set(SHAPES.map((s) => JSON.stringify(s.cells))).size, 37);
});

// @spec CORE-SHAPE-002
test('каталог: у всех 37 записей маски согласованы с клетками, поля корректны', () => {
  for (const s of SHAPES) {
    assert.equal(s.size, s.cells.length, s.id);
    assert.equal(s.rows.length, s.h, s.id);
    assert.ok(s.weight > 0, s.id);
    assert.equal(s.tier, s.size <= 2 ? 'small' : s.size <= 4 ? 'medium' : 'large', s.id);
    const rows = new Uint16Array(s.h);
    let maxX = 0;
    let maxY = 0;
    for (const [x, y] of s.cells) {
      rows[y] |= 1 << x;
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    assert.deepEqual([...s.rows], [...rows], s.id);
    assert.equal(s.w, maxX + 1, s.id);
    assert.equal(s.h, maxY + 1, s.id);
    let bits = 0;
    for (let m of rows) { while (m) { m &= m - 1; bits++; } }
    assert.equal(bits, s.size, s.id);
  }
  assert.ok(SHAPE_BY_ID.P1);
  assert.ok(SHAPE_BY_ID.SQ3);
});
