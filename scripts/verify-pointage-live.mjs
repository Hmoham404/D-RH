import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Read-only production UI check against the configured, real Supabase source.
// Any unexpected automatic write is blocked and makes this check fail.
const url = process.argv[2] || 'http://127.0.0.1:4177';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Africa/Lagos' });
const page = await context.newPage();
const writes = [];
const errors = [];
const attemptedPayloads = [];
let remotePayload;
page.on('response', async (response) => {
  if (response.request().method() === 'GET' && response.url().includes('rh-pointage-analysis')) {
    try { remotePayload = (await response.json())?.payload; } catch { /* Network diagnostic only. */ }
  }
});
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/rest/v1/**', async (route) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
    writes.push(route.request().method());
    const body = route.request().postDataJSON();
    if (body?.payload) attemptedPayloads.push(body.payload);
    return route.abort('blockedbyclient');
  }
  return route.continue();
});
try {
  const observations = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!attempt) await page.goto(url);
    else await page.reload();
    const picker = page.locator('#daily-analysis-date');
    await picker.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#daily-analysis-date')?.value === '2026-10-03', null, { timeout: 30000 });
    const dates = await picker.locator('option').evaluateAll((options) => options.map((item) => item.value));
    assert.deepEqual(dates, ['2026-10-03']);
    assert.equal(await picker.locator('option:checked').innerText(), '03 oct 2026');
    const period = await page.locator('.mod-period-picker--topbar small').innerText();
    assert.match(period, /26 sept\. 2026.*25 oct\. 2026/);
    observations.push({ attempt: attempt + 1, date: await picker.inputValue(), label: '03 oct 2026', period });
  }
  // Observe the delayed effect path too, without modifying the real database.
  await page.waitForTimeout(10000);
  assert.equal(await page.locator('#daily-analysis-date').inputValue(), '2026-10-03');
  if (writes.length && remotePayload && attemptedPayloads.length) {
    const shape = (payload) => ({ version: payload.dateNormalizationVersion, sourceOnlyVersion: payload.sourceOnlyVersion,
      period: [payload.periodStart, payload.periodEnd], breakMinutes: payload.calculationRules?.breakMinutes,
      rebuild: payload.dateRebuildRequired, rows: payload.rawRows?.length, dayRows: payload.dayRows?.length,
      weekly: (payload.weeklySheets || []).map((sheet) => ({ days: sheet.dayColumns.map((day) => day.isoDate), rows: sheet.rows.length })),
      current: payload.currentFilePointage ? shape({ ...payload.currentFilePointage, currentFilePointage: null }) : null });
    console.error(JSON.stringify({ unexpectedWrite: { before: shape(remotePayload), after: shape(attemptedPayloads[0]) } }));
  }
  assert.deepEqual(writes, [], 'A normal reload must not rewrite the repaired snapshot.');
  assert.deepEqual(errors, [], 'The live dashboard emitted a browser error.');
  console.log(JSON.stringify({ verified: true, observations, unexpectedWrites: writes.length, browserErrors: errors.length }));
} finally {
  await browser.close();
}
