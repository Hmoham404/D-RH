import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { prepareDailyPointage, buildDailyTable, getCurrentFilePointage, buildAttendanceByDay } from './dailyPointage.js';
import { correctDailyPointage, verifyPointageCorrectionCode } from './pointageCorrection.js';

const employees = [{ id: '4', fullName: 'Employé A', status: 'Actif', department: 'Production', kind: 'MOD' },
  { id: '6', fullName: 'Employé B', status: 'Actif', department: 'Production', kind: 'MOI' }];
const rules = { dateOrder: 'mdy', closeDays: true, breakMinutes: 0, roundingMinutes: 1 };
async function snapshot(rows, previous = null) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['ID Emp.', 'Nom', 'Temps du Ptg', 'Terminal'], ...rows]), 'Export');
  return prepareDailyPointage({ name: 'test.xlsx', arrayBuffer: async () => XLSX.write(book, { type: 'array', bookType: 'xlsx' }) }, employees, previous, rules);
}
const table = (value) => buildDailyTable(getCurrentFilePointage(value), employees, ['2026-09-15']);
test('RH correction replaces odd punches, recalculates totals and retains original punches for audit', async () => {
  const original = await snapshot([[4, 'Employé A', '09/15/2026 07:09']]);
  const copy = JSON.stringify(original);
  const next = await correctDailyPointage(original, employees, { employeeKey: '4', isoDate: '2026-09-15', entry: '07:00', exit: '16:00' });
  const restored = JSON.parse(JSON.stringify(next));
  const day = table(restored).rows[0].days[0];
  assert.equal(day.status, 'POINTAGE');
  assert.equal(day.display, '09:00');
  assert.equal(restored.rawRows.filter((row) => row.employeeKey === '4').length, 2);
  assert.equal(restored.currentFilePointage.rawRows.length, 2);
  assert.equal(restored.manualCorrections[0].before.punches.length, 1);
  assert.equal(restored.manualCorrections[0].before.status, 'AVR');
  assert.equal(restored.generatedAt, original.generatedAt);
  assert.equal(JSON.stringify(original), copy);
});
test('ABS correction creates a presence, recalculates late arrivals and keeps history and other employees', async () => {
  const old = await snapshot([[4, 'Employé A', '09/14/2026 07:00'], [4, 'Employé A', '09/14/2026 16:00']]);
  const original = await snapshot([[4, 'Employé A', '09/15/2026 07:00'], [4, 'Employé A', '09/15/2026 16:00']], old);
  const next = await correctDailyPointage(original, employees, { employeeKey: '6', isoDate: '2026-09-15', entry: '08:00', exit: '16:30' });
  assert.equal(table(next).rows[1].days[0].display, '08:30');
  assert.equal(table(next).rows[0].days[0].display, '09:00');
  const [attendance] = buildAttendanceByDay(table(next));
  assert.equal(attendance.absences.length, 0);
  assert.equal(attendance.late[0].delay, 30);
  assert.equal(next.rawRows.filter((row) => row.isoDate === '2026-09-14').length, 2);
  assert.equal(next.currentFilePointage.rawRows.some((row) => row.isoDate === '2026-09-14'), false);
  assert.equal(next.manualCorrections[0].before.status, 'ABS');
});
test('correction rejects invalid hours, empty hours, reverse times and unrelated dates', async () => {
  const original = await snapshot([[4, 'Employé A', '09/15/2026 07:09']]);
  const change = { employeeKey: '4', isoDate: '2026-09-15', entry: '07:00', exit: '16:00' };
  await assert.rejects(correctDailyPointage(original, employees, { ...change, entry: '25:00' }), /valides/);
  await assert.rejects(correctDailyPointage(original, employees, { ...change, exit: '06:00' }), /après/);
  await assert.rejects(correctDailyPointage(original, employees, { ...change, isoDate: '2026-09-16' }), /Seuls/);
  await assert.rejects(correctDailyPointage(original, employees, { ...change, entry: '', exit: '' }), /au moins/);
  await assert.rejects(correctDailyPointage(original, employees, { ...change, exit: '07:00' }), /après/);
});
test('green attendance can be corrected repeatedly, made odd and completed again', async () => {
  const original = await snapshot([[4, 'Employé A', '09/15/2026 07:00'], [4, 'Employé A', '09/15/2026 16:00']]);
  const change = { employeeKey: '4', isoDate: '2026-09-15', entry: '08:00', exit: '17:30' };
  const revised = await correctDailyPointage(original, employees, change);
  assert.equal(table(revised).rows[0].days[0].display, '09:30');
  for (const hours of [{ entry: '08:00', exit: '' }, { entry: '', exit: '17:30' }]) {
    const partial = JSON.parse(JSON.stringify(await correctDailyPointage(revised, employees, { ...change, ...hours })));
    const day = table(partial).rows[0].days[0];
    assert.equal(day.status, 'AVR');
    assert.equal(day.display, hours.entry || hours.exit);
    assert.equal(day.workedMinutes, 0);
    assert.equal(day.entry.slice(11, 16), hours.entry);
    assert.equal(day.exit.slice(11, 16), hours.exit);
    assert.equal(partial.currentFilePointage.rawRows.length, 1);
    const completed = await correctDailyPointage(partial, employees, change);
    assert.equal(table(completed).rows[0].days[0].status, 'POINTAGE');
    assert.equal(table(completed).rows[0].days[0].display, '09:30');
    assert.equal(completed.rawRows.length, 2);
    assert.equal(completed.manualCorrections.length, 3);
    assert.equal(completed.manualCorrections[1].before.status, 'POINTAGE');
  }
});
test('an empty or incorrect RH code is rejected', async () => {
  assert.equal(await verifyPointageCorrectionCode(''), false);
  assert.equal(await verifyPointageCorrectionCode('incorrect'), false);
});
