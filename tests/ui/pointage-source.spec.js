import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { prepareDailyPointage } from '../../src/lib/dailyPointage.js';

const employees = [
  { recordId: 'test-4', id: '4', zk: '4', fullName: 'Existing employee', department: 'PRODUCTION', kind: 'MOD', status: 'Actif', hiredAt: '2026-01-01' },
  { recordId: 'test-6', id: '6', zk: '6', fullName: 'Directory only', department: 'PRODUCTION', kind: 'MOD', status: 'Actif', hiredAt: '2026-01-01' },
  { recordId: 'test-342', id: '342', zk: '342', fullName: 'New arrival 342', department: 'PRODUCTION', kind: 'MOD', status: 'Actif', hiredAt: '2026-09-24' },
  { recordId: 'test-343', id: '343', zk: '343', fullName: 'New arrival 343', department: 'PRODUCTION', kind: 'MOD', status: 'Actif', hiredAt: '' },
];
const rules = { dateOrder: 'mdy', closeDays: true, breakMinutes: 0, roundingMinutes: 1 };
function upload(rows) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['ID Emp.', 'Nom', 'Temps du Ptg'], ...rows]), 'Export');
  return { name: '24.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) };
}
async function analyze(rows) {
  const file = upload(rows);
  return prepareDailyPointage({ name: file.name, arrayBuffer: async () => file.buffer }, employees, null, rules);
}
const card = (page, label) => page.locator('.daily-dashboard__legacy > .rh-kpi-grid > .rh-kpi-card')
  .filter({ has: page.locator('.rh-kpi-card__label', { hasText: label }) });

for (const viewport of [{ width: 1500, height: 1000 }, { width: 390, height: 844 }]) {
  test(`source-only summary, lists, reload and replacement at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.clock.install({ time: new Date('2026-09-24T12:00:00Z') });
    const rows = [21, 22, 23, 24].flatMap((day) => [
      [4, 'Existing employee', `09/${day}/2026 07:20`],
      [4, 'Existing employee', `09/${day}/2026 16:00`],
    ]);
    rows.push([342, 'New arrival 342', '09/24/2026 08:00'], [343, 'New arrival 343', '09/24/2026 08:00']);
    let saved = JSON.parse(JSON.stringify(await analyze(rows)));
    delete saved.sourceOnlyVersion;
    delete saved.currentFilePointage.sourceOnlyVersion;
    saved.weeklySheets[0].rows.push({ id: '6', employeeKey: '6', fullName: 'Directory only',
      days: saved.weeklySheets[0].dayColumns.map((day) => ({ ...day, status: 'ABS', display: 'ABS' })) });
    const writes = [];
    let historyCleared = false;
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/rest/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== 'GET') {
        writes.push({ method: request.method(), url: request.url(), body: request.postData() });
        if (request.method() === 'POST') {
          saved = request.postDataJSON().find((row) => row.id === 'rh-pointage-analysis').payload;
        }
        if (request.method() === 'PATCH') historyCleared = request.postDataJSON().payload.cleared === true;
        await route.fulfill({ json: null });
        return;
      }
      const payload = url.searchParams.get('id')?.startsWith('like.rh-pointage-history-')
        ? [{ id: 'rh-pointage-history-old', cleared: String(historyCleared) }]
        : url.pathname.endsWith('/hr_staff_directory') ? employees
        : url.searchParams.get('id') === 'eq.rh-pointage-analysis' ? { payload: saved, updated_at: '2026-09-24T10:00:00Z' } : null;
      await route.fulfill({ json: payload });
    });
    await page.goto('/');
    await expect(page.locator('#daily-analysis-date')).toHaveValue('2026-09-24');
    await expect(card(page, 'Effectif global').locator('strong')).toHaveText('3');
    await expect(card(page, 'Absents').locator('strong')).toHaveText('0');
    await expect(card(page, 'Retards').locator('strong')).toHaveText('2');
    for (const day of [21, 22, 23]) {
      await page.locator('#daily-analysis-date').selectOption(`2026-09-${day}`);
      await expect(card(page, 'Effectif global').locator('strong')).toHaveText('1');
      await expect(card(page, 'Presents').locator('strong')).toHaveText('1');
      await expect(card(page, 'Absents').locator('strong')).toHaveText('0');
      await expect(card(page, 'Retards').locator('strong')).toHaveText('0');
      await card(page, 'Absents').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).not.toContainText('New arrival');
      await expect(dialog).not.toContainText('Directory only');
      await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
      await card(page, 'Effectif global').click();
      await expect(page.getByRole('dialog').locator('tbody tr')).toHaveCount(1);
      await expect(page.getByRole('dialog')).toContainText('Existing employee');
      await page.getByRole('dialog').getByRole('button', { name: 'Fermer', exact: true }).click();
    }
    await page.screenshot({ path: `test-results/source-only-${viewport.width}.png`, fullPage: true });
    await page.reload();
    await page.locator('#daily-analysis-date').selectOption('2026-09-23');
    await expect(card(page, 'Absents').locator('strong')).toHaveText('0');

    await page.locator('.mod-export-button input[type=file]').setInputFiles(upload([[4, 'Existing employee', '09/24/2026 07:00']]));
    await expect(page.locator('#daily-analysis-date option')).toHaveCount(1);
    await expect(card(page, 'Effectif global').locator('strong')).toHaveText('1');
    expect(saved.rawRows).toHaveLength(1);
    expect(saved.sourceOnlyVersion).toBe(1);
    expect(writes.some((request) => request.method === 'DELETE' && request.url.includes('rh-pointage-history-'))).toBe(true);
    expect(historyCleared).toBe(true);
    await page.reload();
    await expect(page.locator('#daily-analysis-date option')).toHaveCount(1);
    await expect(card(page, 'Absents').locator('strong')).toHaveText('0');
    expect(errors).toEqual([]);
  });
}
