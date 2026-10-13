import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverMissingPayrollDays } from './pointageRecovery.js';

function snapshot(dates, tag) {
  const p = { dateNormalizationVersion: 9, sourceDateContract: 'mdy-visible-v1',
    calculationRules: { dateOrder: 'mdy', breakMinutes: 30 },
    rawRows: dates.map((isoDate) => ({ isoDate, sourceId: '4', employeeKey: '4',
      pointageAt: `${isoDate}T07:36:00`, sourceDateIso: `${isoDate}T07:36:00`,
      sourceDateEncoding: 'canonical-iso', tag })),
    dayRows: [], sourceWeeklySheets: [], manualCorrections: [], closedDates: dates,
    importDiagnostics: { incomingDates: dates }, dailySummaries: dates.map((isoDate) => ({ isoDate, tag })),
  };
  return { ...p, currentFilePointage: structuredClone(p) };
}

test('recovery restores only missing days of the same payroll month and preserves recent values', () => {
  const current = snapshot(['2026-10-12', '2026-10-13'], 'current');
  const older = snapshot(['2026-09-25', '2026-09-26', '2026-10-10', '2026-10-12'], 'archive');
  const before = structuredClone({ current, older });
  const result = recoverMissingPayrollDays(current, older, [], '2026-10-13');
  assert.deepEqual(result.restoredDates, ['2026-09-26', '2026-10-10']);
  assert.equal(result.snapshot.rawRows.length, 4);
  assert.equal(result.snapshot.rawRows.find((r) => r.isoDate === '2026-10-12').tag, 'current');
  assert.equal(result.snapshot.rawRows.some((r) => r.isoDate === '2026-10-11'), false);
  assert.deepEqual({ current, older }, before);
  assert.deepEqual(recoverMissingPayrollDays(result.snapshot, older, [], '2026-10-13').restoredDates, []);
});

test('recovery cannot replace a different current payroll period', () => {
  assert.throws(() => recoverMissingPayrollDays(snapshot(['2026-11-01'], 'new'),
    snapshot(['2026-10-01'], 'old'), [], '2026-10-13'), /autre periode/);
});
