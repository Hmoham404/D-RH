import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayrollAbsenceDataset, buildPayrollPresenceDataset, getAbsenceTargetBand } from './presenceTrend.js';
import { getPayrollPeriod } from './pointagePeriod.js';
const day = (isoDate, present = 8, expected = 10) => ({ isoDate, departments: [
  { label: 'PRODUCTION', kinds: [{ label: 'MOD', present, expected }, { label: 'MOI', present: 1, expected: 1 }] },
] });

test('each imported day has exactly one point, with no monthly or weekly duplicate averages', () => {
  const period = getPayrollPeriod('2026-10-13');
  const history = period.dates.slice(0, 18).map((date, index) => day(date, index % 10));
  const points = buildPayrollPresenceDataset(history, period);
  assert.equal(points.length, 30);
  assert.equal(points.filter((p) => p.value !== null).length, 18);
  assert.equal(points[0].isoDate, '2026-09-26');
  assert.equal(points.at(-1).isoDate, '2026-10-25');
  assert.equal(points[0].value, 0, 'Zero attendance is real data, not a missing day.');
});

test('two days produce two measured points, and gaps remain null including weekends', () => {
  const points = buildPayrollPresenceDataset([day('2026-10-12'), day('2026-10-13', 7)], getPayrollPeriod('2026-10-13'));
  assert.equal(points.filter((p) => p.value !== null).length, 2);
  assert.equal(points.find((p) => p.isoDate === '2026-10-11').value, null);
  assert.equal(points.find((p) => p.isoDate === '2026-10-12').value, 80);
  assert.equal(points.find((p) => p.isoDate === '2026-10-13').value, 70);
});

test('the current month excludes old data and never invents a default rate', () => {
  const points = buildPayrollPresenceDataset([day('2026-09-25'), day('2026-10-12', 0, 0)], getPayrollPeriod('2026-10-13'));
  assert.ok(points.every((p) => p.value === null));
});

test('MOD absence trend uses weekdays in the 26-to-25 payroll period and treats unimported dates as gaps', () => {
  const period = getPayrollPeriod('2026-10-13');
  const history = [day('2026-09-25', 0, 10), day('2026-09-26', 0, 20), day('2026-09-27', 0, 20),
    day('2026-09-28', 19, 20), day('2026-10-13', 18, 20), day('2026-10-24', 0, 20), day('2026-10-25', 0, 20)];
  const points = buildPayrollAbsenceDataset(history, period);
  assert.equal(points.length, 20);
  assert.equal(points[0].isoDate, '2026-09-28');
  assert.equal(points.at(-1).isoDate, '2026-10-23');
  assert.ok(points.every((point) => ![0, 6].includes(new Date(`${point.isoDate}T12:00:00Z`).getUTCDay())));
  assert.equal(points[0].value, 5);
  assert.equal(points.find((point) => point.isoDate === '2026-10-13').value, 10);
  assert.equal(points.find((point) => point.isoDate === '2026-10-12').value, null);
  assert.equal(points.find((point) => point.isoDate === '2026-09-25'), undefined);
  assert.equal(points.find((point) => point.isoDate === '2026-09-26'), undefined);
  assert.equal(points.find((point) => point.isoDate === '2026-09-27'), undefined);
});

test('absence target is green below 5%, yellow at 5%, and red above 5%', () => {
  assert.equal(getAbsenceTargetBand(4.99), 'below');
  assert.equal(getAbsenceTargetBand(5), 'target');
  assert.equal(getAbsenceTargetBand(5.01), 'above');
  assert.equal(getAbsenceTargetBand(null), 'empty');
});
