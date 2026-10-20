import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { prepareDailyPointage } from '../../src/lib/dailyPointage.js';
import { canonicalizePointageSnapshotDates } from '../../src/lib/pointageSnapshotDates.js';
import { PAYROLL_RETENTION } from '../../src/lib/payrollPointage.js';

const CURRENT_ID = 'rh-pointage-analysis';
const ACTIVE_ID = 'rh-staff-directory-active-records';
const clone = (value) => JSON.parse(JSON.stringify(value));
const staff = Array.from({ length: 350 }, (_, index) => ({
  record_id: `startup-${index + 1}`, id: String(index + 1), zk: String(index + 1),
  full_name: `Startup fixture ${index + 1}`, department: 'PRODUCTION', service: 'MET',
  kind: 'MOD', status: 'Actif', hired_at: '2026-01-01',
}));
let payload;

test.beforeAll(async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['ID Emp.', 'Nom', 'Temps du Ptg'],
    [1, 'Startup fixture 1', '10/01/2026 08:00'],
    [1, 'Startup fixture 1', '10/01/2026 17:00'],
  ]), 'Export');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const imported = await prepareDailyPointage({ name: 'startup.xlsx', arrayBuffer: async () => buffer },
    [{ id: '1', zk: '1', fullName: 'Startup fixture 1', status: 'Actif', department: 'PRODUCTION', service: 'MET' }], null,
    { dateOrder: 'mdy', breakMinutes: 24, roundingMinutes: 1, closeDays: true });
  payload = clone(canonicalizePointageSnapshotDates({ ...imported, dateEncoding: null,
    retentionPolicy: PAYROLL_RETENTION, payrollPeriodStart: '2026-09-26' }));
});

function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

async function mockStartup(page, { readGate, directoryGate, repairGate, corrections = [] } = {}) {
  const state = { current: { id: CURRENT_ID, payload: clone(payload), updated_at: '2026-10-14T08:00:00Z' },
    snapshotReads: 0, correctionReads: 0, activeReads: 0, batches: [], writes: [] };
  await page.clock.install({ time: new Date('2026-10-14T12:00:00Z') });
  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const id = url.searchParams.get('id') || '';
    if (url.pathname.endsWith('/hr_staff_directory')) {
      const ids = (url.searchParams.get('record_id') || '').slice(4, -1).split(',')
        .map((value) => value.replaceAll('"', ''));
      state.batches.push(ids);
      if (directoryGate) await directoryGate.promise;
      return route.fulfill({ json: staff.filter((employee) => ids.includes(employee.record_id)) });
    }
    if (request.method() === 'PATCH') {
      state.writes.push(request.postDataJSON());
      if (repairGate) await repairGate.promise;
      state.current = { ...state.current, ...request.postDataJSON(), updated_at: '2026-10-14T09:00:00Z' };
      return route.fulfill({ json: [{ updated_at: state.current.updated_at }] });
    }
    if (id === `eq.${ACTIVE_ID}`) {
      state.activeReads++;
      return route.fulfill({ json: { payload: { recordIds: staff.map((employee) => employee.record_id) } } });
    }
    if (id.startsWith('like.rh-pointage-correction-')) {
      state.correctionReads++;
      if (readGate) await readGate.promise;
      return route.fulfill({ json: corrections.map((correction) => ({ payload: { correction } })) });
    }
    if (id === `eq.${CURRENT_ID}`) {
      state.snapshotReads++;
      if (readGate) await readGate.promise;
      return route.fulfill({ json: state.current });
    }
    return route.fulfill({ json: null });
  });
  return state;
}

test('startup shares concurrent reads and loads independent requests together without losing staff or corrections', async ({ page }) => {
  const readGate = gate();
  const directoryGate = gate();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const state = await mockStartup(page, { readGate, directoryGate, corrections: [{
    employeeKey: '1', isoDate: '2026-10-01', correctedAt: '2026-10-02T12:00:00Z',
    after: { entry: '10:00', exit: '16:00', breakMinutes: 0 },
  }] });
  await page.goto('/');
  try {
    // Neither a large snapshot download nor one directory batch can hold up
    // starting the other independent reads. No timing threshold is needed.
    await expect.poll(() => [state.snapshotReads, state.correctionReads, state.activeReads]).toEqual([1, 1, 1]);
    await expect.poll(() => state.batches.length).toBe(4);
    expect(state.batches.flat()).toHaveLength(350);
  } finally {
    readGate.release();
    directoryGate.release();
  }
  await expect(page.locator('.mod-export-button--topbar input')).toBeEnabled();
  await expect(page.locator('.daily-import .rh-table tbody tr')).toHaveCount(350);
  await expect(page.locator('.daily-import .rh-table tbody tr').first()).toContainText('06:00');
  expect(state.writes).toEqual([]);
  expect(errors).toEqual([]);

  // Settled requests are never a persistent cache: explicit reload sees new data.
  state.current.payload.fileName = 'fresh-server-import.xlsx';
  const reloaded = await page.evaluate(async () => {
    const store = await import('/src/services/pointageSnapshotStore.js');
    const [first, second] = await Promise.all([store.loadPointageSnapshot(), store.loadPointageSnapshot()]);
    return [first.data.fileName, second.data.fileName];
  });
  expect(reloaded).toEqual(['fresh-server-import.xlsx', 'fresh-server-import.xlsx']);
  expect(state.snapshotReads).toBe(2);
  expect(state.correctionReads).toBe(2);
});

test('loaded attendance is visible while an automatic repair is pending and edits wait for verification', async ({ page }) => {
  const repairGate = gate();
  await page.addInitScript(() => localStorage.setItem('rh-dashboard-pointage-break-minutes', '30'));
  const state = await mockStartup(page, { repairGate });
  await page.goto('/');
  try {
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(page.locator('.daily-import .rh-table tbody tr')).toHaveCount(350);
    await expect(page.locator('.daily-import .rh-table tbody tr').first()).toContainText('08:30');
    await expect(page.locator('.mod-export-button--topbar input')).toBeDisabled();
    await expect(page.getByRole('button', { name: '24 min', exact: true })).toBeDisabled();
    await expect(page.locator('.delete-zone input')).toBeDisabled();
    await page.locator('.daily-import__time').first().click();
    await expect(page.locator('.pointage-correction input').first()).toBeDisabled();
    await page.locator('.daily-import__dialog .rh-modal__close').click();
  } finally {
    repairGate.release();
  }
  await expect(page.locator('.mod-export-button--topbar input')).toBeEnabled();
  expect(state.writes).toHaveLength(1);
  expect(state.current.payload.calculationRules.breakMinutes).toBe(30);
  await expect(page.locator('.daily-import .rh-table tbody tr').first()).toContainText('08:30');
});
