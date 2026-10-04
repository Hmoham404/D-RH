import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { canonicalizePointageSnapshotDates } from './pointageSnapshotDates.js';
import { normalizeSavedPointageSnapshot, prepareDailyPointage } from './dailyPointage.js';
import { correctDailyPointage } from './pointageCorrection.js';

const employees = [{ id: '4', zk: '4', fullName: 'Z', status: 'Actif' }];
const rules = { dateOrder: 'mdy', breakMinutes: 24, roundingMinutes: 1, closeDays: true };
const serial = (month, day, hour = 7, minute = 36, second = 19) =>
  (Date.UTC(2026, month - 1, day, hour, minute, second) - Date.UTC(1899, 11, 30)) / 86400000;
const clone = (value) => JSON.parse(JSON.stringify(value));
const fields = ['sourceDateValue', 'sourceDateText', 'sourceDateFormat', 'sourceDateEncoding', 'sourceDateIso'];
const sourceMetadata = (row) => Object.fromEntries(fields.map((key) => [key, row[key]]));

test('legacy administrative workbook retains explicit weekly source cells during date migration', () => {
  const weeklySheets = [{ sheetName: 'S1', dayColumns: [{ isoDate: '2026-10-03' }],
    rows: [{ id: '4', days: [{ isoDate: '2026-10-03', status: 'ABS', display: 'ABS' }] }] }];
  const result = canonicalizePointageSnapshotDates({ rawRows: [], weeklySheets });
  assert.deepEqual(result.sourceWeeklySheets, weeklySheets);
  assert.deepEqual(canonicalizePointageSnapshotDates(clone(result)).sourceWeeklySheets, weeklySheets);
});

test('manual correction preserves other original regional Excel cells through a later recalculation', async () => {
  const workbook = XLSX.utils.book_new();
  const values = [serial(1, 10), serial(1, 10, 17), serial(3, 10), serial(3, 10, 17)];
  const sheet = XLSX.utils.aoa_to_sheet([['ID Emp.', 'Nom', 'Temps du Ptg'], ...values.map((value) => [4, 'Z', value])]);
  values.forEach((_, index) => { sheet[`C${index + 2}`].z = 'm/d/yy h:mm'; });
  XLSX.utils.book_append_sheet(workbook, sheet, 'SOURCE_POINTAGE');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const imported = await prepareDailyPointage({ name: '1003.xlsx', arrayBuffer: async () => buffer }, employees, null, rules);
  const untouched = imported.rawRows.filter((row) => row.isoDate === '2026-10-03').map(sourceMetadata);
  const corrected = await correctDailyPointage(clone(imported), employees,
    { employeeKey: '4', isoDate: '2026-10-01', entry: '08:00', exit: '17:00' });
  const recalculated = await normalizeSavedPointageSnapshot(clone(corrected), employees, 30);
  assert.deepEqual(recalculated.rawRows.filter((row) => row.isoDate === '2026-10-03').map(sourceMetadata), untouched);
  assert.deepEqual(recalculated.currentFilePointage.rawRows.filter((row) => row.isoDate === '2026-10-03').map(sourceMetadata), untouched);
  assert.equal(recalculated.manualCorrections[0].before.punches[0].sourceDateValue, values[0]);
  assert.ok(recalculated.rawRows.filter((row) => row.isoDate === '2026-10-01')
    .every((row) => row.sourceDateEncoding === 'iso-text' && row.pointageAt.startsWith('2026-10-01T')));
});

function legacySnapshot(rawRows, extra = {}) {
  const current = { sourceOnlyVersion: 1, dateNormalizationVersion: 6,
    fileName: '1003.xlsx', calculationRules: rules, sourceWeeklySheets: [],
    closedDates: ['2026-01-10'], importDiagnostics: { incomingDates: ['2026-01-10'] },
    rawRows, dayRows: [{ employeeKey: '4', isoDate: '2026-01-10', entry: '10/01/2026 07:36:19' }],
    ...extra };
  return { ...current, currentFilePointage: clone(current), dailySummaries: [{ isoDate: '2026-01-10', entries: 1 }] };
}

test('preserved numeric visible source repairs an old snapshot and remains October across repeated canonicalization', () => {
  const snapshot = legacySnapshot([{ sourceId: '4', sourceName: 'Z', employeeKey: '4',
    isoDate: '2026-01-10', pointageAt: '2026-01-10T07:36:19', pointageAtDisplay: '10/01/2026 07:36:19',
    sourceDateValue: serial(1, 10), sourceDateText: '10/01/2026 07:36',
    sourceDateFormat: 'dd/mm/yyyy hh:mm' }]);
  const repaired = canonicalizePointageSnapshotDates(snapshot);
  assert.equal(repaired.rawRows[0].pointageAt, '2026-10-01T07:36:19');
  assert.equal(repaired.rawRows[0].sourceDateEncoding, 'excel-visible-mdy');
  assert.deepEqual(repaired.closedDates, ['2026-10-01']);
  assert.deepEqual(repaired.currentFilePointage.importDiagnostics.incomingDates, ['2026-10-01']);
  assert.equal(repaired.dayRows[0].entry, '01/10/2026 07:36:19');
  assert.equal(repaired.dateRebuildRequired, true);
  assert.deepEqual(canonicalizePointageSnapshotDates(clone(repaired)), clone(repaired));
  assert.equal(snapshot.rawRows[0].isoDate, '2026-01-10');
});

test('version 8 standard regional serials migrate from the former encoding and remain October after JSON reload', async () => {
  const snapshot = legacySnapshot([{ sourceId: '4', sourceName: 'Z', employeeKey: '4',
    isoDate: '2026-03-10', pointageAt: '2026-03-10T07:33:59', pointageAtDisplay: '10/03/2026 07:33:59',
    sourceDateValue: serial(3, 10, 7, 33, 59), sourceDateText: '3/10/26 7:33',
    sourceDateFormat: 'm/d/yy h:mm', sourceDateEncoding: 'excel-serial', sourceDateIso: '2026-03-10T07:33:59' }],
  { dateNormalizationVersion: 8, closedDates: ['2026-03-10'],
    importDiagnostics: { incomingDates: ['2026-03-10'] },
    dayRows: [{ employeeKey: '4', isoDate: '2026-03-10', entry: '10/03/2026 07:33:59' }] });
  const canonical = canonicalizePointageSnapshotDates(snapshot);
  assert.equal(canonical.rawRows[0].pointageAt, '2026-10-03T07:33:59');
  assert.equal(canonical.rawRows[0].sourceDateEncoding, 'excel-localized-mdy');
  assert.equal(canonical.rawRows[0].sourceDateText, '3/10/26 7:33');
  assert.equal(canonical.currentFilePointage.rawRows[0].isoDate, '2026-10-03');
  assert.equal(canonical.dateRebuildRequired, true);
  assert.deepEqual(canonicalizePointageSnapshotDates(clone(canonical)), clone(canonical));
  const rebuilt = await normalizeSavedPointageSnapshot(clone(snapshot), employees, 12);
  assert.equal(rebuilt.rawRows[0].pointageAt, '2026-10-03T07:33:59');
  assert.deepEqual(rebuilt.rawRows.map(sourceMetadata), canonical.rawRows.map(sourceMetadata));
  assert.deepEqual(rebuilt.currentFilePointage.rawRows.map(sourceMetadata), canonical.rawRows.map(sourceMetadata));
  assert.equal(rebuilt.currentFilePointage.calculationRules.breakMinutes, 12);
  const reloaded = await normalizeSavedPointageSnapshot(clone(rebuilt), employees, 12);
  assert.equal(reloaded.rawRows[0].pointageAt, '2026-10-03T07:33:59');
  assert.deepEqual(reloaded.rawRows.map(sourceMetadata), canonical.rawRows.map(sourceMetadata));
});

test('ISO calendar dates retain October regardless of filename, French UI label and historical version', () => {
  for (const fileName of ['1003.xlsx', '1109.xlsx', 'export.xlsx']) {
    const snapshot = legacySnapshot([{ sourceId: '4', sourceName: 'Z', employeeKey: '4',
      isoDate: '2026-10-03', pointageAt: '2026-10-03T07:24:00', pointageAtDisplay: '03/10/2026 07:24:00' }],
    { fileName, closedDates: ['2026-10-03'], importDiagnostics: { incomingDates: ['2026-10-03'] }, dayRows: [] });
    const canonical = canonicalizePointageSnapshotDates(snapshot);
    assert.equal(canonical.rawRows[0].pointageAt, '2026-10-03T07:24:00');
    assert.equal(canonical.rawRows[0].sourceDateEncoding, 'canonical-iso');
    assert.equal(canonical.dateRebuildRequired, false);
    assert.deepEqual(canonicalizePointageSnapshotDates(clone(canonical)), clone(canonical));
  }
});

test('explicit legacy DMY import labels repair October once and modern French labels remain presentation data', () => {
  const snapshot = legacySnapshot([{ sourceId: '4', sourceName: 'Z', employeeKey: '4',
    isoDate: '2026-01-10', pointageAt: '2026-01-10T07:36:19', pointageAtDisplay: '10/01/2026 07:36:19' }],
  { calculationRules: { ...rules, dateOrder: 'dmy' } });
  const canonical = canonicalizePointageSnapshotDates(snapshot);
  assert.equal(canonical.rawRows[0].pointageAtDisplay, '01/10/2026 07:36:19');
  assert.equal(canonical.currentFilePointage.calculationRules.dateOrder, 'mdy');
  assert.deepEqual(canonicalizePointageSnapshotDates(clone(canonical)), clone(canonical));
});

test('conflicting original date mappings request a rebuild without guessing derived dates', () => {
  const snapshot = legacySnapshot([
    { sourceId: '4', sourceName: 'Z', employeeKey: '4', isoDate: '2026-01-10',
      pointageAt: '2026-01-10T07:36:19', sourceDateValue: '10/01/2026 07:36:19' },
    { sourceId: '4', sourceName: 'Z', employeeKey: '4', isoDate: '2026-01-10',
      pointageAt: '2026-01-10T17:36:19', sourceDateValue: '01/10/2026 17:36:19' },
  ]);
  const canonical = canonicalizePointageSnapshotDates(snapshot);
  assert.equal(canonical.dateRebuildRequired, true);
  assert.equal(canonical.currentFilePointage.dateRebuildRequired, true);
  assert.deepEqual(canonical.rawRows.map((row) => row.isoDate), ['2026-10-01', '2026-01-10']);
  assert.equal(canonical.dayRows[0].isoDate, '2026-01-10');
});

test('SQL JSON reload and break recalculation preserve original workbook metadata in both snapshot layers', async () => {
  const workbook = XLSX.utils.book_new();
  const values = [serial(1, 10), serial(1, 10, 17), serial(2, 10), serial(2, 10, 17)];
  const sheet = XLSX.utils.aoa_to_sheet([['ID Emp.', 'Nom', 'Temps du Ptg'], ...values.map((value) => [4, 'Z', value])]);
  values.forEach((_, index) => { sheet[`C${index + 2}`].z = 'dd/mm/yyyy hh:mm'; });
  XLSX.utils.book_append_sheet(workbook, sheet, 'SOURCE_POINTAGE');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const imported = await prepareDailyPointage({ name: '1003.xlsx', arrayBuffer: async () => buffer }, employees, null, rules);
  const reload = await normalizeSavedPointageSnapshot(clone(imported), employees, 24);
  const recalculated = await normalizeSavedPointageSnapshot(clone(reload), employees, 12);
  assert.deepEqual(recalculated.rawRows.map((row) => row.isoDate), ['2026-10-01', '2026-10-01', '2026-10-02', '2026-10-02']);
  assert.equal(recalculated.currentFilePointage.calculationRules.breakMinutes, 12);
  assert.deepEqual(recalculated.rawRows.map(sourceMetadata), imported.rawRows.map(sourceMetadata));
  assert.deepEqual(recalculated.currentFilePointage.rawRows.map(sourceMetadata), imported.rawRows.map(sourceMetadata));
  const again = await normalizeSavedPointageSnapshot(clone(recalculated), employees, 12);
  assert.deepEqual(again.rawRows.map(sourceMetadata), imported.rawRows.map(sourceMetadata));
  assert.deepEqual(again.rawRows.map((row) => row.pointageAt), recalculated.rawRows.map((row) => row.pointageAt));
  assert.equal(again.dateRebuildRequired, false);
});
