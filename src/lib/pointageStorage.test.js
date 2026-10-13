import assert from 'node:assert/strict';
import test from 'node:test';
import { compactPointageStorage, expandPointageStorage } from './pointageStorage.js';
import { canonicalizePointageSnapshotDates } from './pointageSnapshotDates.js';
import { prepareDailyPointage } from './dailyPointage.js';
import * as XLSX from 'xlsx';

function snapshot() {
  const parent = { dateNormalizationVersion: 9, sourceDateContract: 'mdy-visible-v1',
    calculationRules: { dateOrder: 'mdy', breakMinutes: 24 },
    rawRows: [{ isoDate: '2026-10-13', pointageAt: '2026-10-13T07:36:00',
      sourceDateValue: '10/13/2026 07:36', sourceDateEncoding: 'mdy-text', sourceDateIso: '2026-10-13T07:36:00' }],
    manualCorrections: [{ employeeKey: '4', after: { breakMinutes: 30 } }],
    dayRows: [{ isoDate: '2026-10-13', entry: '13/10/2026 07:36:00' }], sourceWeeklySheets: [] };
  return { ...parent, currentFilePointage: structuredClone(parent) };
}

test('storage round trip preserves every nested value and source cell exactly', () => {
  const original = snapshot();
  const packed = compactPointageStorage(original);
  assert.equal(packed.currentFilePointage, null);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(original).length);
  assert.deepEqual(expandPointageStorage(JSON.parse(JSON.stringify(packed))), original);
  assert.deepEqual(compactPointageStorage(packed), packed);
  assert.ok(original.currentFilePointage.rawRows.length);
});

test('a different nested date, correction, or source value prevents deduplication', () => {
  for (const mutate of [
    (p) => { p.currentFilePointage.rawRows[0].sourceDateValue = '10/14/2026 07:36'; },
    (p) => { p.currentFilePointage.rawRows[0].isoDate = '2026-10-14'; },
    (p) => { p.currentFilePointage.manualCorrections[0].after.breakMinutes = 0; },
  ]) {
    const original = snapshot(); mutate(original);
    assert.deepEqual(compactPointageStorage(original), original);
  }
});

test('canonicalization expands storage before date repair and keeps all days in the nested view', () => {
  const original = snapshot();
  assert.deepEqual(canonicalizePointageSnapshotDates(compactPointageStorage(original)),
    canonicalizePointageSnapshotDates(original));
});

test('old full snapshots remain readable and invalid references fail explicitly', () => {
  const original = snapshot();
  assert.deepEqual(expandPointageStorage(original), original);
  assert.throws(() => expandPointageStorage({ currentFilePointage: null,
    currentFilePointageParentFields: ['missing'] }), /invalide/);
  assert.throws(() => expandPointageStorage({ currentFilePointage: null,
    currentFilePointageParentFields: ['currentFilePointage'] }), /invalide/);
});

test('adding a new date after compact storage reload retains every previously imported day', async () => {
  const employees = [{ id: '4', zk: '4', fullName: 'Test', status: 'Actif' }];
  const rules = { dateOrder: 'mdy', breakMinutes: 24, closeDays: true };
  const file = (day) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['ID Emp.', 'Nom', 'Temps du Ptg'],
      [4, 'Test', `10/${day}/2026 07:36`], [4, 'Test', `10/${day}/2026 17:00`],
    ]), 'POINTAGE');
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    return { name: `${day}.xlsx`, arrayBuffer: async () => buffer };
  };
  const first = await prepareDailyPointage(file(13), employees, null, rules);
  const packed = JSON.parse(JSON.stringify(compactPointageStorage(first)));
  const reloaded = canonicalizePointageSnapshotDates(packed);
  const next = await prepareDailyPointage(file(14), employees, reloaded, rules);
  const afterReload = canonicalizePointageSnapshotDates(JSON.parse(JSON.stringify(compactPointageStorage(next))));
  assert.deepEqual([...new Set(afterReload.rawRows.map((row) => row.isoDate))].sort(), ['2026-10-13', '2026-10-14']);
  assert.equal(afterReload.rawRows.length, 4);
  assert.deepEqual(afterReload.currentFilePointage.rawRows, afterReload.rawRows);
});
