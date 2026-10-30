import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailyModPresenceDataset, buildDailyModWorkforceDataset, buildPayrollAbsenceDataset, buildPayrollPresenceDataset, getDailyModChartPeriod, getAbsenceTargetBand } from './presenceTrend.js';
import { getPayrollPeriod } from './pointagePeriod.js';
const day = (isoDate, present = 8, expected = 10) => ({ isoDate, departments: [
  { label: 'PRODUCTION', kinds: [{ label: 'MOD', present, expected }, { label: 'MOI', present: 1, expected: 1 }] },
] });

test('daily MOD counts end at the selected day minus one even when later punches are available', () => {
  const history = [day('2026-10-26', 6), day('2026-10-27', 0), day('2026-10-29', 9), day('2026-10-30', 10)];
  const { start, end, cutoff, points } = buildDailyModPresenceDataset(history, '2026-10-29');
  assert.equal(start, '2026-10-26');
  assert.equal(end, '2026-11-25');
  assert.equal(cutoff, '2026-10-28');
  assert.equal(points.length, 31);
  assert.equal(points.at(-1).isoDate, '2026-11-25');
  assert.deepEqual(points.slice(0, 3).map(({ isoDate, value }) => [isoDate, value]), [
    ['2026-10-26', 6], ['2026-10-27', 0], ['2026-10-28', null],
  ]);
  assert.ok(points.filter((point) => point.isoDate > cutoff).every((point) => point.value === null && !point.imported));
});

test('absence and daily presence share the selected-date cutoff, including missing days', () => {
  const history = [day('2026-10-26', 10), day('2026-10-27', 9), day('2026-10-29', 0), day('2026-10-30', 0)];
  const absence = buildPayrollAbsenceDataset(history, getDailyModChartPeriod('2026-10-29'));
  const presence = buildDailyModPresenceDataset(history, '2026-10-29');
  assert.deepEqual(absence.slice(0, 3).map(({ isoDate, value }) => [isoDate, value]), [
    ['2026-10-26', 0], ['2026-10-27', 10], ['2026-10-28', null],
  ]);
  assert.equal(absence.at(-1).isoDate, presence.end);
  assert.ok(absence.filter((point) => point.isoDate > presence.cutoff).every((point) => point.value === null && !point.imported));
  const boundary = buildPayrollAbsenceDataset([day('2026-10-23', 9), day('2026-10-26', 0)], getDailyModChartPeriod('2026-10-26'));
  assert.equal(boundary[0].isoDate, '2026-10-26');
  assert.equal(boundary.at(-1).isoDate, '2026-11-25');
  assert.ok(boundary.every((point) => point.value === null));
});

test('daily counts include weekends and sum only production MOD, excluding MOI and administration', () => {
  const history = [day('2026-11-01', 5)];
  history[0].departments.push({ label: 'Production · Assemblage', kinds: [{ label: 'MOD', present: 3, expected: 4 }] },
    { label: 'Administration', kinds: [{ label: 'MOD', present: 20, expected: 20 }] });
  const { points } = buildDailyModPresenceDataset(history, '2026-11-02');
  assert.equal(points.at(-1).isoDate, '2026-11-25');
  assert.equal(points.find((point) => point.isoDate === '2026-11-01').value, 8);
  assert.equal(points.find((point) => point.isoDate === '2026-10-31').value, null);
});

test('the full payroll axis and J-1 cutoff follow month, leap-day and year boundaries independently', () => {
  for (const [today, start, end, cutoff] of [
    ['2026-10-26', '2026-10-26', '2026-11-25', '2026-10-25'],
    ['2026-11-01', '2026-10-26', '2026-11-25', '2026-10-31'],
    ['2027-01-01', '2026-12-26', '2027-01-25', '2026-12-31'],
    ['2028-03-01', '2028-02-26', '2028-03-25', '2028-02-29'],
    ['2026-10-27', '2026-10-26', '2026-11-25', '2026-10-26'],
  ]) {
    const dataset = buildDailyModPresenceDataset([], today);
    assert.equal(dataset.start, start);
    assert.equal(dataset.end, end);
    assert.equal(dataset.cutoff, cutoff);
    assert.equal(dataset.points.at(-1).isoDate, end);
    assert.ok(dataset.points.every((point) => point.value === null));
  }
});

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

test('daily active MOD workforce follows hires and departures independently of attendance imports', () => {
  const staff = [
    { status: 'Actif', hiredAt: '01/01/2026' },
    { status: 'STC', hiredAt: '01/01/2026', inactiveFrom: '29/10/2026' },
    { status: 'Actif', hiredAt: '30/10/2026' },
    { status: 'Actif', hiredAt: '01/11/2026' },
    { status: 'Actif', hiredAt: '' },
    { status: 'STC', inactiveFrom: '' },
    { status: 'Actif', kind: 'MOI' },
    { status: 'Actif', department: 'ADMINISTRATION' },
  ].map((employee) => ({ kind: 'MOD', department: 'PRODUCTION', ...employee }));
  const { start, end, points } = buildDailyModWorkforceDataset(staff, '2026-10-31');
  assert.equal(start, '2026-10-26');
  assert.equal(end, '2026-11-25');
  assert.deepEqual(points.slice(0, 5).map(({ value }) => value), [3, 3, 3, 2, 3]);
  assert.ok(points.slice(5).every((point) => point.value === null));
  assert.equal(buildDailyModWorkforceDataset([], '2026-10-31').points[0].value, 0);
  assert.ok(buildDailyModWorkforceDataset(staff, '2026-10-26').points.every((point) => point.value === null));
});

test('absence target is green below 5%, yellow from 5% to 5.5%, and red above 5.5%', () => {
  assert.equal(getAbsenceTargetBand(4.99), 'below');
  assert.equal(getAbsenceTargetBand(5), 'target');
  assert.equal(getAbsenceTargetBand(5.01), 'target');
  assert.equal(getAbsenceTargetBand(5.25), 'target');
  assert.equal(getAbsenceTargetBand(5.5), 'target');
  assert.equal(getAbsenceTargetBand(5.51), 'above');
  assert.equal(getAbsenceTargetBand(null), 'empty');
});
