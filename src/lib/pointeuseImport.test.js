import test from 'node:test';
import assert from 'node:assert/strict';
import { getNewPointeuseRecords, preparePointeuseImport } from './pointeuseImport.js';
import { correctDailyPointage } from './pointageCorrection.js';
import { buildDailyTable, getCurrentFilePointage } from './dailyPointage.js';

const employees = [{ id: '3', zk: '003', fullName: 'Fixture', status: 'Actif', hiredAt: '2026-01-01' }];
const rules = { breakMinutes: 30, roundingMinutes: 1, closeDays: true, dateOrder: 'mdy' };
const record = (time, extra = {}) => ({ userId: '003', timestamp: `2026-10-12T${time}:00`, terminal: 'Fixture', ...extra });

test('clock reads preserve source seconds and deduplicate identical punches across terminals', () => {
  const midnight = { userId: '003', timestamp: '2026-10-01T00:15:19', terminal: 'A' };
  const result = getNewPointeuseRecords([midnight, { ...midnight, terminal: 'B', userId: '3' }], null, '2026-10-20');
  assert.equal(result.length, 1);
  assert.equal(result[0].timestamp, midnight.timestamp);
});

test('clock imports stay inside the current 26-to-today period and reject malformed timestamps', () => {
  assert.deepEqual(getNewPointeuseRecords([
    record('08:00', { timestamp: '2026-09-25T08:00:00' }),
    record('08:00', { timestamp: '2026-10-21T08:00:00' }),
  ], null, '2026-10-20'), []);
  assert.throws(() => getNewPointeuseRecords([record('08:00', { timestamp: '2026-02-31T08:00:00' })], null, '2026-10-20'));
});

test('polling identical data skips a write, while new clock punches retain RH corrections', async () => {
  const source = [record('08:00'), record('17:00')];
  const first = await preparePointeuseImport(source, null, employees, rules, '2026-10-20');
  assert.equal(first.added, 2);
  const corrected = await correctDailyPointage(first.snapshot, employees,
    { employeeKey: '3', isoDate: '2026-10-12', entry: '08:00', exit: '16:00', breakMinutes: 0 });
  const identical = await preparePointeuseImport(source, corrected, employees, rules, '2026-10-20');
  assert.deepEqual(identical, { snapshot: null, added: 0 });
  const updated = await preparePointeuseImport([...source, record('17:30')], corrected, employees, rules, '2026-10-20');
  assert.equal(updated.added, 1);
  assert.equal(updated.snapshot.rawRows.length, 3);
  assert.deepEqual(updated.snapshot.manualCorrections, corrected.manualCorrections);
  const day = buildDailyTable(getCurrentFilePointage(updated.snapshot), employees, ['2026-10-12']).rows[0].days[0];
  assert.equal(day.workedMinutes, 480);
  assert.equal(day.status, 'POINTAGE');
});
