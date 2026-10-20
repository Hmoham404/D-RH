import { test, expect } from '@playwright/test';

const CURRENT = 'rh-pointage-analysis';
const clone = (value) => JSON.parse(JSON.stringify(value));
const initialRecords = ['08:00:19', '17:00:22'].map((time) => ({
  userId: '003', timestamp: `2026-10-19T${time}`, terminal: 'MYC INJECTION', punch: 0,
}));

async function databaseAndClocks(page) {
  const state = { current: null, writes: [], records: clone(initialRecords), readCount: 0, unreachable: false, failSave: false };
  await page.clock.install({ time: new Date('2026-10-20T12:00:00Z') });
  await page.route('http://127.0.0.1:8788/**', async (route) => {
    const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:5176',
      'Access-Control-Allow-Headers': 'Content-Type, X-Pointage-Client', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    state.readCount++;
    expect(route.request().postDataJSON()).toEqual({ from: '2026-09-26', through: '2026-10-20' });
    return route.fulfill({ status: state.unreachable ? 503 : 200, headers, json: {
      protocol: 'myc-pointage-bridge-v1', ok: !state.unreachable,
      devices: [201, 202, 203].map((value) => ({ host: `10.10.100.${value}`, connected: !state.unreachable, code: state.unreachable ? 'unreachable' : undefined })),
      records: state.unreachable ? [] : state.records,
    } });
  });
  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/hr_staff_directory')) return route.fulfill({ json: [{
      record_id: 'fixture-3', id: '3', zk: '003', full_name: 'Clock fixture',
      hired_at: '2026-01-01', status: 'Actif', department: 'PRODUCTION', service: 'MET', kind: 'MOD',
    }] });
    if (request.method() === 'GET') {
      const id = url.searchParams.get('id');
      return route.fulfill({ json: id === `eq.${CURRENT}` ? state.current : id?.startsWith('like.') ? [] : null });
    }
    state.writes.push(clone(request.postDataJSON()));
    if (state.failSave) return route.fulfill({ status: 500, json: { message: 'fixture unavailable' } });
    const data = request.postDataJSON();
    state.current = { ...state.current, ...data, updated_at: `2026-10-20T12:00:0${state.writes.length}Z` };
    return route.fulfill({ json: url.searchParams.has('select') ? [{ updated_at: state.current.updated_at }] : null });
  });
  return state;
}

test('site reads the PC connector, saves clock punches once and preserves attendance after a failed save', async ({ page }) => {
  const state = await databaseAndClocks(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Connexion aux pointeuses MYC' });
  await expect(panel).toContainText('3/3 pointeuses lues · 2 nouveaux passages enregistrés.');
  await expect(page.locator('.daily-import .rh-table tbody tr')).toHaveCount(1);
  expect(state.current.payload.rawRows.map((row) => row.pointageAt)).toEqual(initialRecords.map((row) => row.timestamp));
  expect(state.writes).toHaveLength(1);
  await page.screenshot({ path: 'test-results/pointeuses-desktop.png' });

  await panel.getByRole('button', { name: 'Synchroniser les pointeuses' }).click();
  await expect(panel).toContainText('0 nouveaux passages enregistrés.');
  expect(state.writes).toHaveLength(1);

  state.records.push({ ...initialRecords[0], timestamp: '2026-10-20T08:05:00' });
  state.failSave = true;
  await panel.getByRole('button', { name: 'Synchroniser les pointeuses' }).click();
  await expect(panel).toContainText('Les nouveaux passages n’ont pas pu être enregistrés.');
  expect(state.current.payload.rawRows).toHaveLength(2);
  await expect(page.locator('#daily-analysis-date')).toHaveValue('2026-10-19');
  expect(errors).toEqual([]);
});

test('mobile site reports unreachable clocks without inventing attendance or overwriting the database', async ({ page }) => {
  const state = await databaseAndClocks(page);
  state.unreachable = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Connexion aux pointeuses MYC' });
  await expect(panel).toContainText('Aucune pointeuse joignable depuis ce PC.');
  expect(state.writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/pointeuses-mobile.png' });
});
