import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPointageRetention } from './pointageRetention.js';
import { getPayrollPeriod } from './pointagePeriod.js';
const period = getPayrollPeriod('2026-10-13');
function record(dates, id = 'rh-pointage-history-123') {
  return { id, updated_at: '2026-10-13T00:00:00Z', payload: {
    dateNormalizationVersion: 9, sourceDateContract: 'mdy-visible-v1', calculationRules: { dateOrder: 'mdy' },
    rawRows: dates.map((isoDate) => ({ isoDate, pointageAt: `${isoDate}T08:00:00`, sourceDateIso: `${isoDate}T08:00:00`, sourceDateEncoding: 'canonical-iso' })),
  } };
}
test('unrelated projects, the home page, and bus data are always protected', () => {
  for (const id of ['articles', 'production-records', 'other-project', 'rh-homepage', 'rh-bus-capacities', 'rh-pointage-history-%']) {
    assert.equal(classifyPointageRetention(record(['2020-01-01'], id), period).action, 'protected');
  }
});
test('only wholly out-of-period pointage may be deleted', () => {
  assert.equal(classifyPointageRetention(record(['2026-09-25']), period).action, 'delete');
  assert.equal(classifyPointageRetention(record(['2026-09-26', '2026-10-25']), period).action, 'keep');
  assert.equal(classifyPointageRetention(record(['2026-09-25', '2026-09-26']), period).action, 'trim-required');
  assert.equal(classifyPointageRetention(record(['2026-10-26']), period).action, 'delete');
});
test('unknown dates require review and current-month archives remain available for recovery', () => {
  assert.equal(classifyPointageRetention(record([]), period).action, 'review');
  assert.equal(classifyPointageRetention(record(['2026-09-26', '2026-10-10']), period).action, 'keep');
});
test('cleared history can be removed, but the cleared current revision is retained', () => {
  const empty = { ...record([]), payload: { cleared: true } };
  assert.equal(classifyPointageRetention(empty, period).action, 'delete');
  assert.equal(classifyPointageRetention({ ...empty, id: 'rh-pointage-analysis' }, period).action, 'keep');
});
