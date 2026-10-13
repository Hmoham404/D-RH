import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayrollPresenceDataset } from './presenceTrend.js';
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
