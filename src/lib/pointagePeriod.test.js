import assert from 'node:assert/strict';
import test from 'node:test';
import { getPayrollPeriod, pointageInPeriod, fillPayrollCalendar, payrollPeriodToDate } from './pointagePeriod.js';

for (const [reference, start, end, count] of [
  ['2026-10-13', '2026-09-26', '2026-10-25', 30],
  ['2026-10-25', '2026-09-26', '2026-10-25', 30],
  ['2026-10-26', '2026-10-26', '2026-11-25', 31],
  ['2027-01-01', '2026-12-26', '2027-01-25', 31],
  ['2028-03-01', '2028-02-26', '2028-03-25', 29],
]) {
  test(`payroll month for ${reference} is inclusive from the 26th to the 25th`, () => {
    const result = getPayrollPeriod(reference);
    assert.equal(result.start, start);
    assert.equal(result.end, end);
    assert.equal(result.dates.length, count);
    assert.equal(new Set(result.dates).size, count);
  });
}

test('current-month filtering keeps both boundaries without changing stored history', () => {
  const dates = ['2026-09-25', '2026-09-26', '2026-10-25', '2026-10-26'];
  const rows = dates.map((isoDate) => ({ isoDate, sourceDateValue: isoDate }));
  const data = { rawRows: rows, dayRows: rows, closedDates: dates, manualCorrections: rows,
    sourceWeeklySheets: [{ dayColumns: rows, rows: [{ days: rows }] }] };
  const before = structuredClone(data);
  const result = pointageInPeriod(data, getPayrollPeriod('2026-10-13'));
  assert.deepEqual(result.rawRows.map((r) => r.isoDate), dates.slice(1, 3));
  assert.deepEqual(result.dayRows, result.rawRows);
  assert.deepEqual(result.closedDates, dates.slice(1, 3));
  assert.deepEqual(result.manualCorrections, result.rawRows);
  assert.deepEqual(result.sourceWeeklySheets[0].rows[0].days, result.rawRows);
  assert.deepEqual(data, before);
});

test('unimported past and future calendar days remain empty rather than absent', () => {
  const imported = { isoDate: '2026-10-12', status: 'POINTAGE', workedMinutes: 480, display: '08:00' };
  const table = { dayColumns: [{ isoDate: imported.isoDate }], rows: [{ employeeKey: '4', days: [imported], totalHours: '08:00' }] };
  const result = fillPayrollCalendar(table, getPayrollPeriod('2026-10-13'));
  assert.equal(result.dayColumns.length, 30);
  assert.equal(result.rows[0].days.length, 30);
  assert.equal(result.rows[0].days.find((d) => d.isoDate === imported.isoDate).status, 'POINTAGE');
  assert.ok(result.rows[0].days.filter((d) => d.isoDate !== imported.isoDate).every((d) => d.status === 'EMPTY' && d.workedMinutes === 0));
  assert.equal(result.rows[0].totalHours, '08:00');
  assert.equal(table.dayColumns.length, 1);
});

test('a previous payroll month does not create rows in the current month', () => {
  const period = getPayrollPeriod('2026-10-26');
  const scoped = pointageInPeriod({ rawRows: [{ isoDate: '2026-10-25' }] }, period);
  assert.equal(scoped.rawRows.length, 0);
  assert.equal(fillPayrollCalendar({ dayColumns: [], rows: [] }, period).rows.length, 0);
});

test('the displayed calendar stops today but the retained payroll period still ends on the 25th', () => {
  const period = getPayrollPeriod('2026-10-13');
  const displayed = payrollPeriodToDate(period, '2026-10-13');
  assert.equal(displayed.start, '2026-09-26');
  assert.equal(displayed.end, '2026-10-13');
  assert.equal(displayed.dates.length, 18);
  assert.equal(period.end, '2026-10-25');
  assert.equal(period.dates.length, 30);
});
