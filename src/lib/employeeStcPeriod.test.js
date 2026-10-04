import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { analyzeEmployeeBaseFile } from './employeeBaseImport.js';
import { getEmployeeStcPeriod, isEmployeeStcInPeriod } from './employeeStatus.js';

const day = (value) => new Date(`${value}T12:00:00`);
const stc = (inactiveFrom) => ({ status: 'STC', inactiveFrom });

test('STC periods switch on the 26th, including year boundaries', () => {
  for (const [selected, start, end] of [
    ['2026-09-25', '2026-08-26', '2026-09-25'],
    ['2026-09-26', '2026-09-26', '2026-10-25'],
    ['2026-10-01', '2026-09-26', '2026-10-25'],
    ['2026-10-25', '2026-09-26', '2026-10-25'],
    ['2026-10-26', '2026-10-26', '2026-11-25'],
    ['2027-01-01', '2026-12-26', '2027-01-25'],
  ]) {
    const period = getEmployeeStcPeriod(day(selected));
    assert.equal(period.periodStart, start);
    assert.equal(period.periodEnd, end);
  }
});

test('October 1 counts September 29 and October 1, but never October 2 early', () => {
  const employees = ['25/09/2026', '26/09/2026', '29/09/2026', '01/10/2026', '02/10/2026', '25/10/2026', '26/10/2026'].map(stc);
  assert.deepEqual(employees.filter((employee) => isEmployeeStcInPeriod(employee, day('2026-10-01'))).map((employee) => employee.inactiveFrom),
    ['26/09/2026', '29/09/2026', '01/10/2026']);
  assert.equal(isEmployeeStcInPeriod(stc('02/10/2026'), day('2026-10-02')), true);
});

test('period endpoints are inclusive and departures disappear in the next period', () => {
  assert.equal(isEmployeeStcInPeriod(stc('25/10/2026'), day('2026-10-25')), true);
  for (const date of ['29/09/2026', '01/10/2026', '25/10/2026']) {
    assert.equal(isEmployeeStcInPeriod(stc(date), day('2026-10-26')), false);
  }
  assert.equal(isEmployeeStcInPeriod(stc('26/10/2026'), day('2026-10-26')), true);
});

test('a complete valid departure date is required even for STC status', () => {
  for (const value of ['', null, undefined, 0, '0', 'SEPT', 'OCT', '09/2026', '10', '31/09/2026', '31/02/2026']) {
    assert.equal(isEmployeeStcInPeriod(stc(value), day('2026-10-01')), false, String(value));
  }
  assert.equal(isEmployeeStcInPeriod(stc('01/10/2026'), new Date('invalid')), false);
});

test('SQL and browser shapes retain the same departure calendar day', () => {
  const nativeSerial = (Date.UTC(2026, 9, 1) - Date.UTC(1899, 11, 30)) / 86400000;
  for (const value of ['01/10/2026', '01/10/26', '2026-10-01', day('2026-10-01'), nativeSerial]) {
    assert.equal(isEmployeeStcInPeriod({ status: 'STC', inactiveFrom: '', inactive_from: value }, day('2026-10-01')), true);
  }
  assert.equal(isEmployeeStcInPeriod({ status: 'Actif', inactiveFrom: '29/09/2026' }, day('2026-10-01')), true);
  assert.equal(isEmployeeStcInPeriod(stc('31/12/2026'), day('2027-01-01')), true);
  assert.equal(isEmployeeStcInPeriod(stc('02/01/2027'), day('2027-01-01')), false);
});

test('native Excel exit dates survive a SQL JSON roundtrip before STC counting', async () => {
  const serial = (value) => (Date.parse(`${value}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000;
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Code', 'Nom', 'Actif/Inactif', 'Inactif A PARTIR'],
    ['1', 'SORTIE SEPT', 'STC', { t: 'n', v: serial('2026-09-29'), z: 'm/d/yy h:mm' }],
    ['2', 'SORTIE OCT1', 'STC', { t: 'n', v: serial('2026-10-01'), z: 'm/d/yy' }],
    ['3', 'SORTIE OCT2', 'STC', { t: 'n', v: serial('2026-10-02'), z: 'dd/mm/yyyy' }],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Personnel');
  const { employees } = await analyzeEmployeeBaseFile({ name: 'personnel.xlsx', arrayBuffer: async () => XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) });
  const rows = JSON.parse(JSON.stringify(employees.map((employee) => ({ status: employee.status, inactive_from: employee.inactiveFrom }))));
  assert.deepEqual(rows.map((row) => row.inactive_from), ['29/09/2026', '01/10/2026', '02/10/2026']);
  assert.equal(rows.filter((row) => isEmployeeStcInPeriod(row, day('2026-10-01'))).length, 2);
  assert.equal(rows.filter((row) => isEmployeeStcInPeriod(row, day('2026-10-02'))).length, 3);
});
