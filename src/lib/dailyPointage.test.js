import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { buildAttendanceByDay, buildDailyTable, formatPointageDate, getCurrentFilePointage, normalizeSavedPointageSnapshot, prepareDailyPointage } from './dailyPointage.js';
import { analyzePointageFile } from './pointageImport.js';
import { getDefaultPointageDate, getLocalPointageDate } from './pointageDates.js';

const employees = [
  { id: '4', zk: '4', fullName: 'ZAIDI SEIFEDDINE', status: 'Actif', department: 'Maintenance', kind: 'MOI' },
  { id: '6', fullName: 'ESSID HOUSSEM EDDINE', status: 'Actif' },
  { id: '10', fullName: 'RTIBI MOKHTAR', status: 'STC' },
];
const rules = { dateOrder: 'mdy', breakMinutes: 0, roundingMinutes: 1, closeDays: true };

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
  assert.equal(result[1].departments.some((group) => group.label === 'Gardiennage'), false);
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
  assert.deepEqual(dates, ['2026-09-10']);
  const table = buildDailyTable(current, employees, dates);
  assert.equal(table.dayColumns.length, 1);
  assert.equal(table.rows[0].days[0].display, '10:23');
  assert.equal(table.rows[0].days[0].entry, '10/09/2026 07:42:00');
  assert.equal(table.rows[0].days[0].exit, '10/09/2026 18:05:00');
  assert.equal(current.rawRows.length, 2);
  assert.equal(next.rawRows.length, 2);
  assert.deepEqual([...new Set(next.rawRows.map((row) => row.isoDate))].sort(), ['2026-09-10']);
  assert.deepEqual(getCurrentFilePointage({ rawRows: old.rawRows, dateNormalizationVersion: 3 }).rawRows, old.rawRows);
});

test('French dates, full names and duration without inventing absences or STC', async () => {
  const result = await prepareDailyPointage(file([[4, 'Seifeddine.Z', '09/10/2026 07:42'], [4, 'Seifeddine.Z', '09/10/2026 18:05']]), employees, null, rules);
  assert.equal(cell(result, '4', '2026-09-10').display, '10:23');
  assert.equal(cell(result, '4', '2026-09-10').status, 'POINTAGE');
  assert.equal(cell(result, '6', '2026-09-10'), undefined);
  assert.equal(cell(result, '10', '2026-09-10'), undefined);
  assert.equal(cell(result, '6', '2026-10-10'), undefined);
  assert.deepEqual(result.weeklySheets[0].dayColumns.map((day) => day.isoDate), ['2026-09-10']);
  assert.equal(result.weeklySheets[0].rows[0].fullName, 'ZAIDI SEIFEDDINE');
});

test('future hires are not marked absent before their hire date', async () => {
  const base = [
    ...employees,
    { id: '342', fullName: 'DOUZI KHOULOUD', status: 'Actif', department: 'PRODUCTION', service: 'MET', kind: 'MOD', hired_at: '24/9/2026' },
    { id: '343', fullName: 'CHAIEB BAYA', status: 'Actif', department: 'PRODUCTION', service: 'MET', kind: 'MOD', hiredAt: '24' },
  ];
  const result = await prepareDailyPointage(file([
    [4, 'Z', '09/21/2026 07:42'],
    [4, 'Z', '09/22/2026 07:42'],
    [4, 'Z', '09/23/2026 07:42'],
    [4, 'Z', '09/24/2026 07:42'],
    [342, 'DOUZI KHOULOUD', '09/24/2026 07:30'],
    [343, 'CHAIEB BAYA', '09/24/2026 07:30'],
  ]), base, null, rules);

  assert.equal(cell(result, '342', '2026-09-23').status, 'EMPTY');
  assert.equal(cell(result, '342', '2026-09-24').status, 'AVR');
  assert.equal(cell(result, '343', '2026-09-23').status, 'EMPTY');
  assert.equal(cell(result, '343', '2026-09-24').status, 'AVR');
  for (const date of ['2026-09-21', '2026-09-22', '2026-09-23']) {
    const table = buildDailyTable(result, base, [date]);
    assert.deepEqual(table.rows.map((row) => row.id), ['4']);
  }

  const attendance = buildAttendanceByDay(buildDailyTable(result, base, ['2026-09-23', '2026-09-24']));
  assert.equal(attendance[0].absences.some((person) => person.id === '342'), false);
  assert.equal(attendance[1].absences.some((person) => person.id === '342'), false);
  assert.equal(attendance[0].absences.some((person) => person.id === '343'), false);
  assert.equal(attendance[1].absences.some((person) => person.id === '343'), false);
});

test('blank cells become ABS only from a recorded hire date onward', async () => {
  const base = [
    ...employees,
    { id: '342', fullName: 'DOUZI KHOULOUD', status: 'Actif', hiredAt: '24/09/2026' },
    { id: '343', fullName: 'CHAIEB BAYA', status: 'Actif', hiredAt: '' },
  ];
  const result = await prepareDailyPointage(file([
    [4, 'Z', '09/23/2026 07:30'],
    [4, 'Z', '09/24/2026 07:30'],
    [342, 'DOUZI KHOULOUD', '09/25/2026 07:30'],
    [343, 'CHAIEB BAYA', '09/25/2026 07:30'],
  ]), base, null, rules);

  assert.equal(cell(result, '342', '2026-09-23').display, '-');
  assert.equal(cell(result, '342', '2026-09-24').status, 'ABS');
  assert.equal(cell(result, '342', '2026-09-25').status, 'AVR');
  assert.equal(cell(result, '343', '2026-09-24').display, '-');
  const attendance = buildAttendanceByDay(buildDailyTable(result, base, ['2026-09-23', '2026-09-24']));
  assert.equal(attendance[0].absences.some((person) => person.id === '342'), false);
  assert.equal(attendance[1].absences.some((person) => person.id === '342'), true);
  assert.equal(attendance[1].absences.some((person) => person.id === '343'), false);
});

test('prestation employees without a punch are not imported as absent', async () => {
  const prestationEmployees = [
    ...employees,
    { id: '296', fullName: 'MAHFOUDH BALKIS', status: 'Actif', department: 'PRODUCTION', kind: 'MOD', contract: 'PRESTATION' },
  ];
  const result = await prepareDailyPointage(
    file([[4, 'Z', '09/10/2026 07:42'], [4, 'Z', '09/10/2026 18:05']]),
    prestationEmployees,
    null,
    rules,
  );
  const prestationDay = cell(result, '296', '2026-09-10');
  assert.equal(prestationDay, undefined);

  const attendance = buildAttendanceByDay(buildDailyTable(result, prestationEmployees, ['2026-09-10']))[0];
  assert.equal(attendance.absences.some((person) => person.id === '296'), false);
  assert.equal(attendance.departments.some((department) => department.people.some((person) => person.id === '296')), false);
});

test('direct pointage import defaults to source month/day dates', async () => {
  const result = await analyzePointageFile(file([[4, 'Z', '09/10/2026 07:42']]), employees);
  assert.deepEqual(result.importDiagnostics.incomingDates, ['2026-09-10']);
  assert.equal(result.rawRows[0].pointageAtDisplay, '10/09/2026 07:42:00');
});

test('pointage matching follows the ZK matricule before names and alternate employee codes', async () => {
  const matriculeEmployees = [
    { id: '10', zk: '296', fullName: 'MAHFOUDH BALKIS', status: 'Actif' },
    { id: '296', zk: '999', fullName: 'OTHER PERSON', status: 'Actif' },
  ];
  const matched = await analyzePointageFile(file([[296, 'OTHER PERSON', '09/10/2026 07:42']]), matriculeEmployees);
  assert.equal(matched.rawRows[0].matchedName, 'MAHFOUDH BALKIS');
  assert.equal(matched.rawRows[0].employeeKey, '296');
  assert.equal(matched.rawRows[0].matchMethod, 'Code exact');

  const unknown = await analyzePointageFile(file([[297, 'MAHFOUDH BALKIS', '09/10/2026 07:42']]), matriculeEmployees);
  assert.equal(unknown.rawRows[0].matchState, 'unmatched');
  assert.equal(unknown.rawRows[0].matchMethod, 'Matricule introuvable');
});

test('direct pointage import keeps source month/day order with hyphen dates', async () => {
  const result = await analyzePointageFile(file([[4, 'Z', '09-10-2026 07:42']]), employees);
  assert.deepEqual(result.importDiagnostics.incomingDates, ['2026-09-10']);
  assert.equal(result.rawRows[0].pointageAtDisplay, '10/09/2026 07:42:00');
});

test('direct pointage import reads 09/11 as 11 September', async () => {
  const result = await analyzePointageFile(file([[4, 'Z', '09/11/2026 07:42']]), employees);
  assert.deepEqual(result.importDiagnostics.incomingDates, ['2026-09-11']);
  assert.equal(result.rawRows[0].pointageAtDisplay, '11/09/2026 07:42:00');
});

test('legacy saved dmy current file dates are corrected for settings display', () => {
  const snapshot = {
    currentFilePointage: {
      calculationRules: { dateOrder: 'dmy' },
      closedDates: ['2026-11-09'],
      importDiagnostics: { incomingDates: ['2026-11-09'] },
      rawRows: [{ employeeKey: '4', isoDate: '2026-11-09', pointageAtDisplay: '09/11/2026 07:42:00' }],
      dayRows: [{
        employeeKey: '4',
        isoDate: '2026-11-09',
        entry: '09/11/2026 07:42:00',
        exit: '09/11/2026 18:05:00',
        punchesDisplay: '09/11/2026 07:42:00 | 09/11/2026 18:05:00',
      }],
    },
  };

  const current = getCurrentFilePointage(snapshot);
  assert.deepEqual(current.importDiagnostics.incomingDates, ['2026-09-11']);
  assert.equal(current.rawRows[0].isoDate, '2026-09-11');
  assert.equal(current.rawRows[0].pointageAtDisplay, '11/09/2026 07:42:00');
  assert.equal(current.dayRows[0].entry, '11/09/2026 07:42:00');
});

test('legacy saved inverted dates are corrected even without date order metadata', () => {
  const snapshot = {
    currentFilePointage: {
      closedDates: ['2026-11-09'],
      importDiagnostics: { incomingDates: ['2026-11-09'] },
      rawRows: [{ employeeKey: '4', isoDate: '2026-11-09', pointageAtDisplay: '09/11/2026 07:42:00' }],
      dayRows: [{
        employeeKey: '4',
        isoDate: '2026-11-09',
        entry: '09/11/2026 07:42:00',
        exit: '09/11/2026 18:05:00',
        punchesDisplay: '09/11/2026 07:42:00 | 09/11/2026 18:05:00',
      }],
    },
  };

  const current = getCurrentFilePointage(snapshot);
  assert.deepEqual(current.closedDates, ['2026-09-11']);
  assert.deepEqual(current.importDiagnostics.incomingDates, ['2026-09-11']);
  assert.equal(current.rawRows[0].isoDate, '2026-09-11');
  assert.equal(formatPointageDate(current.rawRows[0].isoDate), '11 sept 2026');
});

test('saved mdy snapshots with incoherent iso dates use the file date text', () => {
  const snapshot = {
    currentFilePointage: {
      calculationRules: { dateOrder: 'mdy' },
      closedDates: ['2026-11-09'],
      importDiagnostics: { incomingDates: ['2026-11-09'] },
      rawRows: [{ employeeKey: '4', isoDate: '2026-11-09', pointageAtDisplay: '09/10/2026 07:42:00' }],
      dayRows: [{
        employeeKey: '4',
        isoDate: '2026-11-09',
        entry: '09/10/2026 07:42:00',
        exit: '09/10/2026 18:05:00',
        punchesDisplay: '09/10/2026 07:42:00 | 09/10/2026 18:05:00',
      }],
    },
  };

  const current = getCurrentFilePointage(snapshot);
  assert.deepEqual(current.closedDates, ['2026-09-10']);
  assert.deepEqual(current.importDiagnostics.incomingDates, ['2026-09-10']);
  assert.equal(formatPointageDate(current.rawRows[0].isoDate), '10 sept 2026');
  assert.equal(current.rawRows[0].pointageAtDisplay, '10/09/2026 07:42:00');
});

test('weekly sheet headers use source month/day order too', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Semaine 2026'],
    ['ID', 'Nom', 'Prenom', 'Departement', 'Categorie', '09/11', 'Heures standard', 'Total', 'Controle'],
    [4, 'ZAIDI', 'SEIFEDDINE', 'PRODUCTION', 'MOD', '08:00', '', '', ''],
  ]), 'S1');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['ID Emp.', 'Nom', 'Temps du Ptg', 'Terminal'],
    [4, 'Z', '09/11/2026 07:42'],
  ]), 'Export');

  const result = await analyzePointageFile(
    { name: 'weekly.xlsx', arrayBuffer: async () => XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) },
    employees,
    { dateOrder: 'mdy' },
  );

  assert.deepEqual(result.weeklySheets[0].dayColumns.map((day) => day.isoDate), ['2026-09-11']);
  assert.deepEqual(result.dailySummaries.map((day) => day.isoDate), ['2026-09-11']);
});

test('daily accumulation is idempotent and completes an incomplete day', async () => {
  const first = await prepareDailyPointage(file([[4, 'Z', '09/10/2026 07:42']]), employees, null, rules);
  assert.equal(cell(first, '4', '2026-09-10').display, '07:42');
  const upload = file([[4, 'Z', '09/10/2026 07:42'], [4, 'Z', '09/10/2026 18:05'], [4, 'Z', '10/10/2026 07:45']]);
  const second = await prepareDailyPointage(upload, employees, first, rules);
  const third = await prepareDailyPointage(upload, employees, JSON.parse(JSON.stringify(second)), rules);
  assert.equal(third.rawRows.length, 3);
  assert.equal(cell(third, '4', '2026-09-10').display, '10:23');
  assert.equal(cell(third, '4', '2026-10-10').status, 'AVR');
  assert.deepEqual(third.weeklySheets, second.weeklySheets);
});

test('reimporting replaces every saved date with the dates in the new file', async () => {
  const first = await prepareDailyPointage(file([
    [4, 'Z', '09/10/2026 07:42'],
    [4, 'Z', '09/10/2026 18:05'],
    [4, 'Z', '09/11/2026 07:45'],
    [4, 'Z', '09/11/2026 17:45'],
  ]), employees, null, rules);
  const second = await prepareDailyPointage(file([
    [4, 'Z', '09/11/2026 08:10'],
    [4, 'Z', '09/11/2026 18:00'],
    [4, 'Z', '09/12/2026 07:50'],
  ]), employees, first, rules);

  assert.equal(cell(second, '4', '2026-09-10'), undefined);
  assert.equal(cell(second, '4', '2026-09-11').display, '09:50');
  assert.equal(cell(second, '4', '2026-09-12').display, '07:50');
  assert.deepEqual(second.rawRows.filter((row) => row.isoDate === '2026-09-11').map((row) => row.pointageAt.slice(11, 16)), ['08:10', '18:00']);
  assert.equal(second.rawRows.length, 3);
});

test('optional pause and rounding apply, open days do not imply absence', async () => {
  const result = await prepareDailyPointage(file([[4, 'Z', '09/10/2026 07:42'], [4, 'Z', '09/10/2026 18:05']]), employees, null, { ...rules, breakMinutes: 30, roundingMinutes: 30, closeDays: false });
  assert.equal(cell(result, '4', '2026-09-10').display, '09:30');
  assert.equal(cell(result, '6', '2026-09-10'), undefined);
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

test('1109 export repairs Excel serial inversion, keeps times and survives reload', async () => {
  const serial = (Date.UTC(2026, 9, 9, 7, 45, 1) - Date.UTC(1899, 11, 30)) / 86400000;
  const nextDay = (Date.UTC(2026, 10, 9, 7, 47, 12) - Date.UTC(1899, 11, 30)) / 86400000;
  const upload = { ...file([[4, 'Z', serial], [4, 'Z', serial + 10 / 24], [4, 'Z', nextDay]]), name: '1109.xlsx' };
  const result = await prepareDailyPointage(upload, employees, null, rules);
  const current = getCurrentFilePointage(JSON.parse(JSON.stringify(result)));
  assert.deepEqual(current.importDiagnostics.incomingDates, ['2026-09-10', '2026-09-11']);
  assert.equal(current.rawRows[0].pointageAtDisplay, '10/09/2026 07:45:01');
  assert.equal(cell(result, '4', '2026-09-10').display, '10:00');
  assert.equal(current.dayRows[1].entry, '11/09/2026 07:47:12');
  const second = await prepareDailyPointage(upload, employees, result, rules);
  assert.equal(second.rawRows.length, 3);
  assert.deepEqual(second.importDiagnostics.incomingDates, current.importDiagnostics.incomingDates);
});

test('1109 export does not invert already correct numeric Excel dates', async () => {
  const serial = (Date.UTC(2026, 8, 11, 8) - Date.UTC(1899, 11, 30)) / 86400000;
  const upload = { ...file([[4, 'Z', serial], [4, 'Z', serial + 9 / 24]]), name: '1109.xlsx' };
  const result = await prepareDailyPointage(upload, employees, null, rules);
  assert.deepEqual(result.importDiagnostics.incomingDates, ['2026-09-11']);
  assert.equal(cell(result, '4', '2026-09-11').display, '09:00');
});

test('1409 export repairs mixed serial dates without moving the 13th and 14th', async () => {
  const serial = (month, day) => (Date.UTC(2026, month - 1, day, 8) - Date.UTC(1899, 11, 30)) / 86400000;
  const upload = { ...file([
    [4, 'Z', serial(11, 9)], [4, 'Z', serial(12, 9)],
    [4, 'Z', '09/13/2026 08:00'], [4, 'Z', '09/14/2026 08:00'],
  ]), name: '1409.xlsx' };
  const result = await prepareDailyPointage(upload, employees, null, rules);
  assert.deepEqual(result.importDiagnostics.incomingDates, ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']);
  assert.deepEqual(getCurrentFilePointage(JSON.parse(JSON.stringify(result))).closedDates, result.importDiagnostics.incomingDates);
});

test('version 2 stored mixed dates are corrected once while valid days keep their times', async () => {
  const original = await prepareDailyPointage(file([
    [4, 'Z', '11/09/2026 08:10'], [4, 'Z', '12/09/2026 08:20'],
    [4, 'Z', '09/13/2026 08:30'], [4, 'Z', '09/14/2026 08:40'],
  ]), employees, null, rules);
  original.fileName = original.currentFilePointage.fileName = '1409.xlsx';
  original.dateNormalizationVersion = original.currentFilePointage.dateNormalizationVersion = 2;
  const restored = await normalizeSavedPointageSnapshot(original, employees);
  assert.deepEqual(restored.importDiagnostics.incomingDates, ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']);
  assert.equal(restored.currentFilePointage.dayRows[2].entry, '13/09/2026 08:30:00');
  assert.equal(restored.currentFilePointage.dayRows[3].entry, '14/09/2026 08:40:00');
  assert.deepEqual(await normalizeSavedPointageSnapshot(restored, employees), restored);
});

test('automatic day selection prefers today and never creates a date outside the file', () => {
  assert.equal(getDefaultPointageDate(['2026-09-15', '2026-09-13', '2026-09-14'], '2026-09-14'), '2026-09-14');
  assert.equal(getDefaultPointageDate(['2026-09-12', '2026-09-11'], '2026-09-14'), '2026-09-12');
  assert.equal(getDefaultPointageDate([], '2026-09-14'), '');
  const now = new Date(2026, 8, 14, 0, 5);
  assert.equal(getLocalPointageDate(now), '2026-09-14');
});

test('stored 1109 mdy snapshots repair coherent but inverted dates and accumulated history', async () => {
  const original = await prepareDailyPointage(file([[4, 'Z', '10/09/2026 08:00'], [4, 'Z', '10/09/2026 18:00'], [4, 'Z', '11/09/2026 08:00']]), employees, null, rules);
  const previous = JSON.parse(JSON.stringify(original));
  previous.fileName = previous.currentFilePointage.fileName = '1109.xlsx';
  delete previous.dateNormalizationVersion;
  delete previous.currentFilePointage.dateNormalizationVersion;
  const current = getCurrentFilePointage(previous);
  assert.deepEqual(current.closedDates, ['2026-09-10', '2026-09-11']);
  assert.equal(current.dayRows[0].entry, '10/09/2026 08:00:00');
  assert.deepEqual(getCurrentFilePointage({ currentFilePointage: current }), current);
  const restored = await normalizeSavedPointageSnapshot(previous, employees);
  assert.deepEqual(restored.dailySummaries.map((day) => day.isoDate), ['2026-09-10', '2026-09-11']);
  assert.deepEqual(restored.weeklySheets.flatMap((week) => week.dayColumns.map((day) => day.isoDate)), ['2026-09-10', '2026-09-11']);
  assert.equal(restored.generatedAt, previous.generatedAt);
  assert.deepEqual(await normalizeSavedPointageSnapshot(restored, employees), restored);
  const next = await prepareDailyPointage(file([[4, 'Z', '09/11/2026 18:00']]), employees, previous, rules);
  assert.deepEqual([...new Set(next.rawRows.map((row) => row.isoDate))].sort(), ['2026-09-11']);
  assert.equal(cell(next, '4', '2026-09-11').display, '18:00');
  assert.deepEqual(previous, JSON.parse(JSON.stringify({ ...original, dateNormalizationVersion: undefined,
    fileName: '1109.xlsx', currentFilePointage: { ...original.currentFilePointage, fileName: '1109.xlsx', dateNormalizationVersion: undefined } })));
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
  assert.deepEqual(result.importDiagnostics.incomingDates, ['2026-08-10', '2026-09-10', '2026-12-10']);
  assert.equal(result.rawRows.length, 6);
  assert.equal(result.importDiagnostics.duplicateRows, 1);
  assert.equal(result.weeklySheets.length, 3);
  assert.equal(cell(result, '4', '2026-08-10').display, '10:00');
  assert.equal(cell(result, '4', '2026-09-10').display, '10:00');
  assert.equal(cell(result, '4', '2026-12-10').display, '08:00');
  assert.equal(cell(result, '6', '2026-08-10'), undefined);
  assert.equal(cell(result, '10', '2026-12-10'), undefined);
  assert.ok(result.rawRows.some((row) => row.sheetName === 'Pointeuse B'));
});

test('table uses only file personnel and dates, including people missing from the RH base', async () => {
  const first = await prepareDailyPointage(file([[4, 'Z', '04/09/2026 08:00'], [4, 'Z', '04/09/2026 16:00']]), employees, null, rules);
  const next = await prepareDailyPointage(file([
    [4, 'Z', '10/09/2026 08:00'], [4, 'Z', '10/09/2026 17:00'],
    [999, 'Unknown', '10/09/2026 08:00'],
  ]), employees, first, rules);
  next.weeklySheets = [{ dayColumns: [{ isoDate: '2026-08-24' }], rows: [] }];
  const table = buildDailyTable(next, employees, next.importDiagnostics.incomingDates);
  assert.deepEqual(table.dayColumns.map((day) => day.isoDate), ['2026-10-09']);
  assert.deepEqual(table.rows.map((row) => row.id), ['4', '999']);
  assert.equal(table.rows[0].totalHours, '09:00');
  assert.equal(table.rows[1].days[0].status, 'AVR');
  assert.equal(next.rawRows.length, 3);
  const combined = buildDailyTable(next, employees, ['2026-04-09', '2026-10-09']);
  assert.equal(combined.dayColumns.length, 1);
  assert.equal(combined.rows[0].totalHours, '09:00');
  const filteredBase = buildDailyTable(next, employees.slice(0, 2), ['2026-10-09']);
  assert.equal(filteredBase.rows.length, 2);
});

test('saved imports replace previous days and use the current RH department and service', async () => {
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
  assert.deepEqual(table.dayColumns.map((day) => day.isoDate), ['2026-09-09']);
  assert.deepEqual(table.rows[0].days.map((day) => day.display), ['09:00']);
  assert.equal(table.rows[0].department, 'PRODUCTION');
  assert.equal(table.rows[0].service, 'INJ');
  assert.equal(table.rows.length, 1);
  const updated = buildDailyTable(reloaded, [{ ...base[0], service: 'TECHNIQUE' }, base[1]], dates);
  assert.equal(updated.rows[0].service, 'TECHNIQUE');
});

test('file statuses distinguish explicit ABS, leave and blank days before and after reload', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Semaine 2026'],
    ['ID', 'Nom', 'Prenom', 'Departement', 'Categorie', '09/23', '09/24', 'Heures standard'],
    [4, 'ZAIDI', 'SEIFEDDINE', 'Maintenance', 'MOI', '08:00', '', ''],
    [6, 'ESSID', 'HOUSSEM EDDINE', 'PRODUCTION', 'MOD', 'ABS', 'CM', ''],
    [342, 'DOUZI', 'KHOULOUD', 'PRODUCTION', 'MOD', 'ABS', 'ABS', ''],
    [343, 'CHAIEB', 'BAYA', 'PRODUCTION', 'MOD', '', '', ''],
  ]), 'S1');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['ID Emp.', 'Nom', 'Temps du Ptg'], [4, 'Z', '09/23/2026 07:00'], [4, 'Z', '09/23/2026 15:00'],
  ]), 'Export');
  const base = [...employees, { id: '342', fullName: 'DOUZI KHOULOUD', hiredAt: '2026-09-24' }];
  const imported = await prepareDailyPointage({ name: 'statuses.xlsx', arrayBuffer: async () => XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) }, base, null, rules);
  const restored = await normalizeSavedPointageSnapshot(JSON.parse(JSON.stringify(imported)), base);
  for (const value of [imported, restored]) {
    const table = buildDailyTable(value, base, ['2026-09-23', '2026-09-24']);
    const [day23, day24] = buildAttendanceByDay(table);
    assert.deepEqual(day23.absences.map((person) => person.id), ['6']);
    assert.deepEqual(day24.absences.map((person) => person.id), ['342']);
    assert.deepEqual(day23.departments.flatMap((group) => group.people).map((person) => person.id).sort(), ['4', '6']);
    assert.equal(day24.departments.flatMap((group) => group.people).find((person) => person.id === '6').status, 'CM');
    assert.equal(table.rows.some((row) => row.id === '343'), false);
  }
});

test('legacy reload discards synthetic absences and all punches outside the latest file', async () => {
  const old = await prepareDailyPointage(file([[6, 'Old', '09/20/2026 08:00']]), employees, null, rules);
  const current = await prepareDailyPointage(file([[4, 'Z', '09/23/2026 07:00']]), employees, null, rules);
  const legacy = JSON.parse(JSON.stringify(current));
  delete legacy.sourceOnlyVersion;
  delete legacy.currentFilePointage.sourceOnlyVersion;
  legacy.rawRows.push(...old.rawRows);
  legacy.weeklySheets[0].rows.push({ employeeKey: '342', id: '342', fullName: 'New arrival',
    days: [{ isoDate: '2026-09-23', status: 'ABS', display: 'ABS' }] });
  const original = JSON.stringify(legacy);
  const restored = await normalizeSavedPointageSnapshot(legacy, [...employees, { id: '342', status: 'Actif' }]);
  assert.equal(JSON.stringify(legacy), original);
  assert.deepEqual(restored.rawRows.map((row) => row.isoDate), ['2026-09-23']);
  assert.deepEqual(restored.weeklySheets[0].rows.map((row) => row.id), ['4']);
  assert.deepEqual(restored.dailySummaries.map((day) => day.isoDate), ['2026-09-23']);
  assert.deepEqual(await normalizeSavedPointageSnapshot(JSON.parse(JSON.stringify(restored)), employees), JSON.parse(JSON.stringify(restored)));
});

test('an empty RH directory still analyzes actual file people without synthetic absences', async () => {
  const result = await prepareDailyPointage(file([[342, 'New arrival', '09/24/2026 07:30']]), [], null, rules);
  const table = buildDailyTable(result, [], ['2026-09-24']);
  assert.deepEqual(table.rows.map((row) => row.id), ['342']);
  const [day] = buildAttendanceByDay(table);
  assert.equal(day.departments[0].expected, 1);
  assert.equal(day.departments[0].present, 1);
  assert.equal(day.absences.length, 0);
});
