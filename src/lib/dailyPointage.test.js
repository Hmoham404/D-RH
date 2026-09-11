import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { buildAttendanceByDay, buildDailyTable, formatPointageDate, getCurrentFilePointage, prepareDailyPointage } from './dailyPointage.js';
import { analyzePointageFile } from './pointageImport.js';

const employees = [
  { id: '4', zk: '4', fullName: 'ZAIDI SEIFEDDINE', status: 'Actif', department: 'Maintenance', kind: 'MOI' },
  { id: '6', fullName: 'ESSID HOUSSEM EDDINE', status: 'Actif' },
  { id: '10', fullName: 'RTIBI MOKHTAR', status: 'STC' },
];
const rules = { dateOrder: 'dmy', breakMinutes: 0, roundingMinutes: 1, closeDays: true };

test('French date labels and daily department rates exclude STC and future hires', () => {
  assert.equal(formatPointageDate('2026-09-08'), '08 sept 2026');
  assert.equal(formatPointageDate('2026-08-09'), '09 août 2026');
  const row = (id, status, days, extra = {}) => ({ id, employeeKey: id, fullName: id, department: 'PRODUCTION', service: 'INJ', employeeStatus: status, days: days.map((status, index) => ({ isoDate: `2026-09-0${index + 8}`, status })), ...extra });
  const result = buildAttendanceByDay({ dayColumns: [{ isoDate: '2026-09-08' }, { isoDate: '2026-09-09' }], rows: [
    row('A', 'Actif', ['POINTAGE', 'ABS']), row('B', 'Actif', ['ABS', 'AVR']),
    row('C', 'STC', ['STC', 'STC']), row('D', 'Actif', ['EMPTY', 'EMPTY'], { hiredAt: '10/09/2026' }),
    row('E', 'Actif', ['AVR', 'EMPTY'], { department: 'ADMINISTRATION', service: 'GARDIENNAGE' }),
  ] });
  assert.equal(result.length, 2);
  const injection = result[0].departments.find((group) => group.label === 'Production · Injection');
  assert.equal(injection.percent, 50);
  assert.equal(injection.expected, 2);
  assert.deepEqual(result[0].absences.map((person) => person.id), ['B']);
  assert.deepEqual(result[1].absences.map((person) => person.id), ['A']);
  const guarding = result[1].departments.find((group) => group.label === 'Gardiennage');
  assert.equal(guarding.percent, 0);
  assert.equal(guarding.unknown, 1);
});

test('department groups combine services, split MOD/MOI and detect lateness from entry only', () => {
  const row = (id, service, kind, entry, display = '10:00') => ({ id, employeeKey: id, fullName: id, department: 'PRODUCTION', service, kind, employeeStatus: 'Actif',
    days: [{ isoDate: '2026-09-08', status: 'POINTAGE', entry: `08/09/2026 ${entry}`, display }] });
  const [result] = buildAttendanceByDay({ dayColumns: [{ isoDate: '2026-09-08' }], rows: [
    row('A', 'INJ', 'MOD', '07:30:00'), row('B', 'INJECTION', 'MOI', '07:45:00', '01:00'),
    row('C', 'NETTOYAGE', 'MOD', '07:20:00'), row('D', 'PROJECT', 'MOI', '07:30:01'),
  ] });
  assert.equal(result.departments.length, 3);
  const production = result.departments.find((group) => group.label === 'Production · Injection');
  assert.equal(production.expected, 2);
  assert.equal(production.kinds.find((kind) => kind.label === 'MOD').late, 0);
  assert.equal(production.kinds.find((kind) => kind.label === 'MOI').late, 1);
  assert.deepEqual(result.late.map((person) => [person.id, person.delay]), [['B', 15], ['D', 1]]);
});
function file(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['ID Emp.', 'Nom', 'Temps du Ptg', 'Terminal'], ...rows,
  ]), 'Export');
  return { name: 'test.xlsx', arrayBuffer: async () => XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) };
}
const cell = (result, id, date) => result.weeklySheets.flatMap((w) => w.rows).filter((r) => r.id === id).flatMap((r) => r.days).find((d) => d.isoDate === date);

test('latest file view excludes history and exposes entry and exit from that file only after reload', async () => {
  const old = await prepareDailyPointage(file([[4, 'Z', '04/09/2026 08:00'], [4, 'Z', '09/10/2026 06:00'], [4, 'Z', '09/10/2026 20:00']]), employees, null, rules);
  const next = await prepareDailyPointage(file([[4, 'Z', '09/10/2026 07:42'], [4, 'Z', '09/10/2026 18:05']]), employees, old, rules);
  const current = getCurrentFilePointage(JSON.parse(JSON.stringify(next)));
  const dates = [...new Set(current.rawRows.map((row) => row.isoDate))];
  assert.deepEqual(dates, ['2026-10-09']);
  const table = buildDailyTable(current, employees, dates);
  assert.equal(table.dayColumns.length, 1);
  assert.equal(table.rows[0].days[0].display, '10:23');
  assert.equal(table.rows[0].days[0].entry, '09/10/2026 07:42:00');
  assert.equal(table.rows[0].days[0].exit, '09/10/2026 18:05:00');
  assert.equal(current.rawRows.length, 2);
  assert.equal(next.rawRows.length, 5);
  assert.equal(getCurrentFilePointage({ rawRows: old.rawRows }), null);
});

test('French dates, full names, duration, active absence and STC', async () => {
  const result = await prepareDailyPointage(file([[4, 'Seifeddine.Z', '09/10/2026 07:42'], [4, 'Seifeddine.Z', '09/10/2026 18:05']]), employees, null, rules);
  assert.equal(cell(result, '4', '2026-10-09').display, '10:23');
  assert.equal(cell(result, '4', '2026-10-09').status, 'POINTAGE');
  assert.equal(cell(result, '6', '2026-10-09').status, 'ABS');
  assert.equal(cell(result, '10', '2026-10-09').status, 'STC');
  assert.equal(cell(result, '6', '2026-10-10'), undefined);
  assert.deepEqual(result.weeklySheets[0].dayColumns.map((day) => day.isoDate), ['2026-10-09']);
  assert.equal(result.weeklySheets[0].rows[0].fullName, 'ZAIDI SEIFEDDINE');
});

test('direct pointage import defaults to French day/month dates', async () => {
  const result = await analyzePointageFile(file([[4, 'Z', '09/10/2026 07:42']]), employees);
  assert.deepEqual(result.importDiagnostics.incomingDates, ['2026-10-09']);
  assert.equal(result.rawRows[0].pointageAtDisplay, '09/10/2026 07:42:00');
});

test('daily accumulation is idempotent and completes an incomplete day', async () => {
  const first = await prepareDailyPointage(file([[4, 'Z', '09/10/2026 07:42']]), employees, null, rules);
  assert.equal(cell(first, '4', '2026-10-09').display, '07:42 !');
  const upload = file([[4, 'Z', '09/10/2026 07:42'], [4, 'Z', '09/10/2026 18:05'], [4, 'Z', '10/10/2026 07:45']]);
  const second = await prepareDailyPointage(upload, employees, first, rules);
  const third = await prepareDailyPointage(upload, employees, JSON.parse(JSON.stringify(second)), rules);
  assert.equal(third.rawRows.length, 3);
  assert.equal(cell(third, '4', '2026-10-09').display, '10:23');
  assert.equal(cell(third, '4', '2026-10-10').status, 'AVR');
  assert.deepEqual(third.weeklySheets, second.weeklySheets);
});

test('optional pause and rounding apply, open days do not imply absence', async () => {
  const result = await prepareDailyPointage(file([[4, 'Z', '09/10/2026 07:42'], [4, 'Z', '09/10/2026 18:05']]), employees, null, { ...rules, breakMinutes: 30, roundingMinutes: 30, closeDays: false });
  assert.equal(cell(result, '4', '2026-10-09').display, '09:30');
  assert.equal(cell(result, '6', '2026-10-09').status, 'EMPTY');
});

test('invalid dates are reported and wholly invalid new imports fail', async () => {
  const result = await prepareDailyPointage(file([[4, 'Z', '31/02/2026 08:00'], [4, 'Z', '09/10/2026 08:00']]), employees, null, rules);
  assert.equal(result.importDiagnostics.rejectedRows, 1);
  await assert.rejects(prepareDailyPointage(file([[4, 'Z', '31/02/2026 08:00']]), employees, result, rules));
});

test('Excel serial dates retain their calendar date and time', async () => {
  const serial = (Date.UTC(2026, 9, 9, 8) - Date.UTC(1899, 11, 30)) / 86400000;
  const result = await prepareDailyPointage(file([[4, 'Z', serial], [4, 'Z', serial + 10 / 24]]), employees, null, rules);
  assert.equal(cell(result, '4', '2026-10-09').display, '10:00');
});

test('all source sheets and dates are grouped even with reordered columns and unsorted rows', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['ID Emp.', 'Nom', 'Temps du Ptg'],
    [4, 'Z', '09/10/2026 18:00'], [4, 'Z', '08/10/2026 07:00'], [4, 'Z', '09/10/2026 08:00'],
  ]), 'Pointeuse A');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Temps du Ptg', 'Nom', 'ID Emp.'],
    ['08/10/2026 17:00', 'Z', 4], ['12/10/2026 08:00', 'Z', 4], ['12/10/2026 16:00', 'Z', 4],
    ['09/10/2026 18:00', 'Z', 4],
  ]), 'Pointeuse B');
  const result = await prepareDailyPointage({ name: 'plusieurs-jours.xlsx', arrayBuffer: async () => XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) }, employees, null, rules);
  assert.deepEqual(result.importDiagnostics.incomingDates, ['2026-10-08', '2026-10-09', '2026-10-12']);
  assert.equal(result.rawRows.length, 6);
  assert.equal(result.importDiagnostics.duplicateRows, 1);
  assert.equal(result.weeklySheets.length, 2);
  assert.equal(cell(result, '4', '2026-10-08').display, '10:00');
  assert.equal(cell(result, '4', '2026-10-09').display, '10:00');
  assert.equal(cell(result, '4', '2026-10-12').display, '08:00');
  assert.equal(cell(result, '6', '2026-10-08').status, 'ABS');
  assert.equal(cell(result, '10', '2026-10-12').status, 'STC');
  assert.ok(result.rawRows.some((row) => row.sheetName === 'Pointeuse B'));
});

test('table uses base personnel and actual file dates, ignoring old weekly tables and unknown people', async () => {
  const first = await prepareDailyPointage(file([[4, 'Z', '04/09/2026 08:00'], [4, 'Z', '04/09/2026 16:00']]), employees, null, rules);
  const next = await prepareDailyPointage(file([
    [4, 'Z', '10/09/2026 08:00'], [4, 'Z', '10/09/2026 17:00'],
    [999, 'Unknown', '10/09/2026 08:00'],
  ]), employees, first, rules);
  next.weeklySheets = [{ dayColumns: [{ isoDate: '2026-08-24' }], rows: [] }];
  const table = buildDailyTable(next, employees, next.importDiagnostics.incomingDates);
  assert.deepEqual(table.dayColumns.map((day) => day.isoDate), ['2026-09-10']);
  assert.deepEqual(table.rows.map((row) => row.id), ['4', '6', '10']);
  assert.equal(table.rows[0].totalHours, '09:00');
  assert.equal(table.rows[1].days[0].status, 'ABS');
  assert.equal(table.rows[2].days[0].status, 'STC');
  assert.equal(next.rawRows.length, 5);
  const combined = buildDailyTable(next, employees, ['2026-09-04', '2026-09-10']);
  assert.equal(combined.dayColumns.length, 2);
  assert.equal(combined.rows[0].totalHours, '17:00');
  const filteredBase = buildDailyTable(next, employees.slice(0, 2), ['2026-09-10']);
  assert.equal(filteredBase.rows.length, 2);
});

test('saved imports keep previous days and use the current RH department and service', async () => {
  const base = [
    { ...employees[0], department: 'PRODUCTION', service: 'INJ' },
    { ...employees[1], department: 'ADMINISTRATION', service: 'GARDIENNAGE' },
  ];
  const first = await prepareDailyPointage(file([[4, 'Z', '08/09/2026 08:00'], [4, 'Z', '08/09/2026 16:00']]), base, null, rules);
  const stored = JSON.parse(JSON.stringify(first));
  const next = await prepareDailyPointage(file([[4, 'Z', '09/09/2026 08:00'], [4, 'Z', '09/09/2026 17:00']]), base, stored, rules);
  const reloaded = JSON.parse(JSON.stringify(next));
  const dates = [...new Set(reloaded.rawRows.map((row) => row.isoDate))].sort();
  const table = buildDailyTable(reloaded, base, dates);
  assert.deepEqual(table.dayColumns.map((day) => day.isoDate), ['2026-09-08', '2026-09-09']);
  assert.deepEqual(table.rows[0].days.map((day) => day.display), ['08:00', '09:00']);
  assert.equal(table.rows[0].department, 'PRODUCTION');
  assert.equal(table.rows[0].service, 'INJ');
  assert.equal(table.rows[1].service, 'GARDIENNAGE');
  const updated = buildDailyTable(reloaded, [{ ...base[0], service: 'TECHNIQUE' }, base[1]], dates);
  assert.equal(updated.rows[0].service, 'TECHNIQUE');
});
