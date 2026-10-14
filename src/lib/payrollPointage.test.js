import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { preparePayrollPointage, emptyPayrollSnapshot, PAYROLL_RETENTION } from './payrollPointage.js';
import { getCurrentFilePointage, buildDailyTable, normalizeSavedPointageSnapshot } from './dailyPointage.js';
import { correctDailyPointage } from './pointageCorrection.js';
import { compactPointageStorage } from './pointageStorage.js';
import { splitPayrollWeeks, getPayrollPeriod, payrollPeriodToDate } from './pointagePeriod.js';

const employees = [1, 2].map((id) => ({ id: String(id), zk: String(id), fullName: `Employe ${id}`, status: 'Actif', hiredAt: '2026-01-01', kind: 'MOD', department: 'PRODUCTION' }));
const rules = { dateOrder: 'mdy', breakMinutes: 30, roundingMinutes: 1, closeDays: true };
function file(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['ID Emp.', 'Nom', 'Temps du Ptg', 'Terminal'], ...rows.map(([id, time]) => [id, `Employe ${id}`, time, 'A'])]), 'Export');
  return { name: 'daily.xlsx', arrayBuffer: async () => XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) };
}
test('daily supplements retain other people and days, complete entry/exit and are idempotent', async () => {
  const first = await preparePayrollPointage(file([[1, '10/12/2026 08:00'], [1, '10/12/2026 17:00'], [2, '10/13/2026 08:00']]), employees, null, rules, '2026-10-13');
  const secondFile = file([[2, '10/13/2026 17:00']]);
  const next = await preparePayrollPointage(secondFile, employees, { ...first, storageRevision: 'revision-1' }, rules, '2026-10-13');
  assert.equal(next.rawRows.length, 4);
  assert.equal(next.dayRows.find((r) => r.employeeKey === '2').roundedMinutes, 510);
  const { storageRevision, ...persisted } = next;
  assert.ok(compactPointageStorage(JSON.parse(JSON.stringify(persisted))).currentFilePointageParentFields);
  const again = await preparePayrollPointage(secondFile, employees, next, rules, '2026-10-13');
  assert.deepEqual(again.rawRows, next.rawRows);
  assert.equal(again.importDiagnostics.duplicateRows, 1);
  const loaded = await normalizeSavedPointageSnapshot(JSON.parse(JSON.stringify(again)), employees, 24);
  assert.equal(loaded.retentionPolicy, PAYROLL_RETENTION);
  assert.equal(getCurrentFilePointage(loaded).rawRows.length, 4);
});
test('only the current 26-to-today window is retained and a wholly out-of-period import fails', async () => {
  const next = await preparePayrollPointage(file([[1, '09/25/2026 08:00'], [1, '09/26/2026 08:00'], [1, '10/14/2026 08:00']]), employees, null, rules, '2026-10-13');
  assert.deepEqual(next.rawRows.map((r) => r.isoDate), ['2026-09-26']);
  assert.equal(next.importDiagnostics.outsidePeriodRows, 2);
  await assert.rejects(preparePayrollPointage(file([[1, '09/25/2026 08:00']]), employees, next, rules, '2026-10-13'), /Import annulé/);
  const newMonth = await preparePayrollPointage(file([[1, '10/26/2026 08:00']]), employees, next, rules, '2026-10-26');
  assert.deepEqual(newMonth.rawRows.map((r) => r.isoDate), ['2026-10-26']);
});
test('reimporting a corrected date restores the source import and clears that date correction', async () => {
  const source = file([[1, '10/12/2026 08:00'], [1, '10/12/2026 17:00']]);
  const first = await preparePayrollPointage(source, employees, null, rules, '2026-10-13');
  const corrected = await correctDailyPointage(first, employees, { employeeKey: '1', isoDate: '2026-10-12', entry: '08:00', exit: '16:00', breakMinutes: 0 });
  const next = await preparePayrollPointage(source, employees, corrected, rules, '2026-10-13');
  const table = buildDailyTable(getCurrentFilePointage(next), employees, ['2026-10-12']);
  assert.equal(table.rows.find((r) => r.employeeKey === '1').days[0].workedMinutes, 510);
  assert.equal(next.rawRows.length, 2);
  assert.equal(next.manualCorrections.length, 0);
});
test('calendar weeks are Monday to Sunday with no duplicate or out-of-period date', () => {
  const dates = payrollPeriodToDate(getPayrollPeriod('2026-10-13'), '2026-10-13').dates;
  const weeks = splitPayrollWeeks(dates.map((isoDate) => ({ isoDate })));
  assert.deepEqual(weeks.map((w) => w.start), ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']);
  assert.deepEqual(weeks.map((w) => w.dayColumns.length), [2, 7, 7, 2]);
  assert.deepEqual(weeks.flatMap((w) => w.dayColumns.map((d) => d.isoDate)), dates);
  assert.equal(emptyPayrollSnapshot('2026-10-26', rules).payrollPeriodStart, '2026-10-26');
});
