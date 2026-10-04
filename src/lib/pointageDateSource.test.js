import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzePointageFile } from './pointageImport.js';
import { isLocalizedExcelDateFormat, parsePointageSourceDate, POINTAGE_DATE_VERSION, POINTAGE_SOURCE_DATE_CONTRACT } from './pointageDateSource.js';

const serial = (month, day, hour = 7, minute = 36, second = 19) =>
  (Date.UTC(2026, month - 1, day, hour, minute, second) - Date.UTC(1899, 11, 30)) / 86400000;
const employees = [{ id: '4', zk: '4', fullName: 'Z', status: 'Actif' }];
function sourceFile(values, { name = 'export.xlsx', format = '', extraSheet = null } = {}) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['ID Emp.', 'Nom', 'Temps du Ptg'],
    ...values.map((value) => [4, 'Z', value])]);
  if (format) values.forEach((_, index) => { sheet[`C${index + 2}`].z = format; });
  XLSX.utils.book_append_sheet(workbook, sheet, 'SOURCE_POINTAGE');
  if (extraSheet) XLSX.utils.book_append_sheet(workbook, extraSheet, 'Deuxieme pointeuse');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return { name, arrayBuffer: async () => buffer };
}

test('numeric Excel values displayed 10/01, 10/02, 10/03 import October 1, 2, 3 with hidden seconds intact', async () => {
  const values = [serial(1, 10), serial(2, 10, 7, 24, 22), serial(3, 10, 8, 4, 59)];
  const result = await analyzePointageFile(sourceFile(values, { format: 'dd/mm/yyyy hh:mm' }), employees);
  assert.deepEqual(result.rawRows.map((row) => row.isoDate), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual(result.rawRows.map((row) => row.pointageAt), ['2026-10-01T07:36:19', '2026-10-02T07:24:22', '2026-10-03T08:04:59']);
  assert.deepEqual(result.rawRows.map((row) => row.sourceDateValue), values);
  assert.deepEqual(result.rawRows.map((row) => row.sourceDateText), ['10/01/2026 07:36', '10/02/2026 07:24', '10/03/2026 08:04']);
  assert.ok(result.rawRows.every((row) => row.sourceDateEncoding === 'excel-visible-mdy'
    && row.sourceDateFormat === 'dd/mm/yyyy hh:mm' && row.sourceDateIso === row.pointageAt));
  assert.equal(result.dateNormalizationVersion, POINTAGE_DATE_VERSION);
  assert.equal(result.sourceDateContract, POINTAGE_SOURCE_DATE_CONTRACT);
});

test('valid numeric month/day cells and unformatted serials retain their Excel calendar date', async () => {
  for (const format of ['mm/dd/yyyy hh:mm', 'General']) {
    const result = await analyzePointageFile(sourceFile([serial(10, 1), serial(10, 2), serial(10, 3)], { format }), employees);
    assert.deepEqual(result.rawRows.map((row) => row.isoDate), ['2026-10-01', '2026-10-02', '2026-10-03']);
    assert.ok(result.rawRows.every((row) => row.sourceDateEncoding === 'excel-serial'));
  }
});

test('Excel standard regional format 22 imports visible October dates despite SheetJS US formatting', async () => {
  const values = [serial(1, 10), serial(2, 10, 7, 24, 22), serial(3, 10, 7, 33, 59)];
  const result = await analyzePointageFile(sourceFile(values, { format: 'm/d/yy h:mm', name: '1003.xlsx' }), employees);
  assert.deepEqual(result.rawRows.map((row) => row.isoDate), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual(result.rawRows.map((row) => row.pointageAt), ['2026-10-01T07:36:19', '2026-10-02T07:24:22', '2026-10-03T07:33:59']);
  assert.deepEqual(result.rawRows.map((row) => row.sourceDateValue), values);
  assert.deepEqual(result.rawRows.map((row) => row.sourceDateText), ['1/10/26 7:36', '2/10/26 7:24', '3/10/26 7:33']);
  assert.ok(result.rawRows.every((row) => row.sourceDateEncoding === 'excel-localized-mdy'
    && row.sourceDateFormat === 'm/d/yy h:mm' && row.sourceDateIso === row.pointageAt));
  const saved = JSON.parse(JSON.stringify(result));
  const restored = saved.rawRows.map((row) => parsePointageSourceDate(row.sourceDateValue, {
    text: row.sourceDateText, format: row.sourceDateFormat, encoding: row.sourceDateEncoding,
  }));
  assert.deepEqual(restored.map((date) => [date.getMonth(), date.getDate(), date.getSeconds()]), [[9, 1, 19], [9, 2, 22], [9, 3, 59]]);
});

test('Excel standard regional format 14 follows the same source policy without filename inference', async () => {
  for (const format of ['m/d/yy', 'mm-dd-yy']) {
    assert.equal(isLocalizedExcelDateFormat(format), true);
    const result = await analyzePointageFile(sourceFile([serial(1, 10)], { format, name: 'arbitrary.xlsx' }), employees);
    assert.equal(result.rawRows[0].pointageAt, '2026-10-01T07:36:19');
    assert.equal(result.rawRows[0].sourceDateEncoding, 'excel-localized-mdy');
  }
  assert.equal(isLocalizedExcelDateFormat('mm/dd/yyyy hh:mm'), false);
  assert.equal(isLocalizedExcelDateFormat('General'), false);
});

test('regional format 22 retains unambiguous native September 30, October 13 and December 31', async () => {
  const values = [serial(9, 30, 7, 33, 11), serial(10, 13, 6, 4, 25), serial(12, 31, 8, 1, 59)];
  const result = await analyzePointageFile(sourceFile(values, { format: 'm/d/yy h:mm', name: '30.xlsx' }), employees);
  const expected = ['2026-09-30T07:33:11', '2026-10-13T06:04:25', '2026-12-31T08:01:59'];
  assert.deepEqual(result.rawRows.map((row) => row.pointageAt), expected);
  assert.ok(result.rawRows.every((row) => row.sourceDateEncoding === 'excel-localized-mdy'));
  const restored = JSON.parse(JSON.stringify(result)).rawRows.map((row) => parsePointageSourceDate(row.sourceDateValue, {
    text: row.sourceDateText, format: row.sourceDateFormat, encoding: row.sourceDateEncoding,
  }));
  assert.deepEqual(restored.map((date) => [date.getMonth() + 1, date.getDate(), date.getSeconds()]), [[9, 30, 11], [10, 13, 25], [12, 31, 59]]);
  assert.equal(parsePointageSourceDate(values[0], { text: '30/09/2026 07:33', format: 'dd/mm/yyyy hh:mm' }), null);
});

test('explicit MDY source dates are independent of export filename and caller locale', async () => {
  for (const name of ['1003.xlsx', '1109.xlsx', '0310.xlsx', 'export.xlsx']) {
    const result = await analyzePointageFile(sourceFile(['10/01/2026 07:36', '10/02/2026 07:24', '10/03/2026 07:25'], { name }), employees, { dateOrder: 'dmy' });
    assert.deepEqual(result.rawRows.map((row) => row.isoDate), ['2026-10-01', '2026-10-02', '2026-10-03']);
    assert.ok(result.rawRows.every((row) => row.sourceDateEncoding === 'mdy-text'));
  }
});

test('primary and additional source sheets preserve independently formatted cells', async () => {
  const additional = XLSX.utils.aoa_to_sheet([['Nom', 'Temps du Ptg', 'ID Emp.'],
    ['Z', serial(2, 10, 8, 3, 9), 4], ['Z', '10/03/2026 08:44:11', 4]]);
  additional.B2.z = 'dd/mm/yyyy hh:mm';
  const result = await analyzePointageFile(sourceFile(['10/01/2026 07:36:19'], { extraSheet: additional }), employees, { allSourceSheets: true });
  assert.deepEqual(result.rawRows.map((row) => row.isoDate), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(result.rawRows[1].sourceDateText, '10/02/2026 08:03');
  assert.equal(result.rawRows[1].sourceDateFormat, 'dd/mm/yyyy hh:mm');
  assert.equal(result.rawRows[1].pointageAt, '2026-10-02T08:03:09');
  assert.equal(result.rawRows[2].sourceDateEncoding, 'mdy-text');
});

test('source metadata can reconstitute the same normalized timestamp after JSON SQL serialization', async () => {
  const result = await analyzePointageFile(sourceFile([serial(1, 10)], { format: '[$-fr-FR]dd/mm/yy hh:mm' }), employees);
  const savedRow = JSON.parse(JSON.stringify(result.rawRows[0]));
  const parsed = parsePointageSourceDate(savedRow.sourceDateValue, {
    text: savedRow.sourceDateText, format: savedRow.sourceDateFormat, encoding: savedRow.sourceDateEncoding,
  });
  assert.equal(savedRow.pointageAt, '2026-10-01T07:36:19');
  assert.equal(parsed.getMonth(), 9);
  assert.equal(parsed.getDate(), 1);
  assert.equal(parsed.getSeconds(), 19);
});

test('canonical ISO rebuilds retain October and do not read French display labels', () => {
  const parsed = parsePointageSourceDate('2026-10-03T07:24:00', { encoding: 'canonical-iso', text: '03/10/2026 07:24' });
  assert.equal(parsed.getMonth(), 9);
  assert.equal(parsed.getDate(), 3);
  assert.equal(parsePointageSourceDate('31/02/2026 07:24'), null);
  assert.equal(parsePointageSourceDate('10/03/2026 25:24'), null);
});

test('merging previous raw rows keeps their initial source metadata', async () => {
  const initial = await analyzePointageFile(sourceFile([serial(1, 10)], { format: 'dd/mm/yyyy hh:mm' }), employees);
  const result = await analyzePointageFile(sourceFile(['10/02/2026 07:24']), employees, { previousRows: initial.rawRows });
  const previous = result.rawRows.find((row) => row.isoDate === '2026-10-01');
  for (const key of ['sourceDateValue', 'sourceDateText', 'sourceDateFormat', 'sourceDateEncoding', 'sourceDateIso']) {
    assert.equal(previous[key], initial.rawRows[0][key]);
  }
});

test('JSON persistence keeps midnight calendar timestamps in every field under Africa/Lagos timezone', () => {
  const source = `
    import * as XLSX from 'xlsx';
    import { analyzePointageFile } from './src/lib/pointageImport.js';
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['ID Emp.', 'Nom', 'Temps du Ptg'],
      [4, 'Z', '10/01/2026 00:15:19'], [4, 'Z', '10/01/2026 23:40:22'],
    ]), 'SOURCE_POINTAGE');
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const result = await analyzePointageFile({ name: '1003.xlsx', arrayBuffer: async () => buffer },
      [{ id: '4', zk: '4', fullName: 'Z', status: 'Actif' }]);
    console.log(JSON.stringify({ offset: new Date(2026, 9, 1).getTimezoneOffset(), result }));
  `;
  const { offset, result } = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)), env: { ...process.env, TZ: 'Africa/Lagos' }, encoding: 'utf8',
  }));
  assert.equal(offset, -60);
  const punches = ['2026-10-01T00:15:19', '2026-10-01T23:40:22'];
  assert.deepEqual(result.rawRows.map((row) => row.pointageAt), punches);
  assert.deepEqual(result.dayRows[0].punches, punches);
  assert.deepEqual(result.employeeRows[0].punches, punches);
  assert.equal(result.employeeRows[0].firstSeenAt, punches[0]);
  assert.equal(result.employeeRows[0].lastSeenAt, punches[1]);
  assert.equal(result.employeeRows[0].firstSeenDate, '2026-10-01');
  assert.equal('sheets' in result.employeeRows[0], false);
  assert.equal('dayKeys' in result.employeeRows[0], false);
});
