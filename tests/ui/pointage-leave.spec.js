import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { readFile } from 'node:fs/promises';
import { preparePayrollPointage } from '../../src/lib/payrollPointage.js';

const employees = [
  { recordId: 'leave-1', id: '1', zk: '1', fullName: 'Present fixture', status: 'Actif', hiredAt: '2026-01-01', department: 'PRODUCTION', kind: 'MOD' },
  { recordId: 'leave-2', id: '2', zk: '2', fullName: 'Leave fixture', status: 'Actif', hiredAt: '2026-01-01', department: 'PRODUCTION', kind: 'MOD' },
];
let snapshot;
let sourceBuffer;
test.beforeAll(async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['ID Emp.', 'Nom', 'Temps du Ptg'],
    [1, 'Present fixture', '11/09/2026 07:00'], [1, 'Present fixture', '11/09/2026 16:00'],
  ]), 'Export');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  sourceBuffer = buffer;
  snapshot = JSON.parse(JSON.stringify(await preparePayrollPointage(
    { name: 'leave.xlsx', arrayBuffer: async () => buffer }, employees, null,
    { breakMinutes: 24, roundingMinutes: 1, closeDays: true, dateOrder: 'mdy' }, '2026-11-10',
  )));
});

for (const width of [1500, 390]) {
  test(`RH leave reasons update ABS, persist, export and remain editable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await page.clock.install({ time: new Date('2026-11-10T12:00:00Z') });
    const state = { corrections: [], failSave: false,
      current: { payload: structuredClone(snapshot), updated_at: '2026-11-10T11:00:00Z' } };
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('http://127.0.0.1:8788/**', (route) => route.abort());
    await page.route('**/rest/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const id = url.searchParams.get('id') || '';
      if (url.pathname.endsWith('/hr_staff_directory')) return route.fulfill({ json: employees.map((employee) => ({
        record_id: employee.recordId, id: employee.id, zk: employee.zk, full_name: employee.fullName,
        status: employee.status, hired_at: employee.hiredAt, department: employee.department, kind: employee.kind,
      })) });
      if (request.method() === 'POST') {
        if (state.failSave) return route.fulfill({ status: 500, json: { message: 'Save unavailable' } });
        const row = request.postDataJSON();
        expect(row.id).toMatch(/^rh-pointage-correction-/);
        state.corrections.push(row);
        return route.fulfill({ json: null });
      }
      if (request.method() === 'PATCH') {
        if (id.startsWith('in.')) {
          const ids = id.slice(4, -1).split(',').map((value) => value.replaceAll('"', ''));
          for (const row of state.corrections) {
            if (ids.includes(row.id)) row.payload = request.postDataJSON().payload;
          }
          return route.fulfill({ json: null });
        }
        expect(id).toBe('eq.rh-pointage-analysis');
        state.current = { ...state.current, ...request.postDataJSON(), updated_at: '2026-11-10T11:01:00Z' };
        return route.fulfill({ json: [{ updated_at: state.current.updated_at }] });
      }
      expect(request.method()).toBe('GET');
      return route.fulfill({ json: id === 'eq.rh-pointage-analysis'
        ? state.current
        : id === 'eq.rh-staff-directory-active-records'
          ? { payload: { recordIds: employees.map((employee) => employee.recordId) } }
          : id.startsWith('like.rh-pointage-correction-') ? state.corrections : id.startsWith('like.') ? [] : null });
    });
    await page.goto('/');
    const heading = page.locator('.daily-import th[data-date="2026-11-09"]');
    const row = page.locator('.daily-import__week-table tbody tr').filter({ hasText: 'Leave fixture' });
    const dialog = page.getByRole('dialog');
    await expect(heading).toContainText('Absents: 1');
    await row.getByRole('button').click();
    const status = dialog.getByLabel('Statut de la journée');
    await expect(status).toHaveValue('ABS');
    await expect(status.locator('option')).toHaveCount(6);
    await status.selectOption('CONGE');
    await expect(dialog.getByLabel(/^Entrée/)).toHaveCount(0);
    await dialog.getByLabel('Code RH', { exact: true }).fill('wrong');
    await dialog.getByRole('button', { name: 'Enregistrer la correction' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Code RH incorrect.');
    expect(state.corrections).toHaveLength(0);
    state.failSave = true;
    await dialog.getByLabel('Code RH', { exact: true }).fill('123X');
    await dialog.getByRole('button', { name: 'Enregistrer la correction' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Save unavailable');
    await expect(row.locator('[data-status="ABS"]')).toBeVisible();
    state.failSave = false;
    for (const [code, label] of [['CONGE', 'Congé'], ['CSS', 'Congé sans solde'], ['CM', 'Congé maladie'], ['REPOS', 'Repos']]) {
      await status.selectOption(code);
      await dialog.getByLabel('Code RH', { exact: true }).fill('123X');
      if (code === 'CSS') await page.screenshot({ path: testInfo.outputPath(`correction-${width}.png`) });
      await dialog.getByRole('button', { name: 'Enregistrer la correction' }).click();
      await expect(dialog).not.toBeVisible();
      await expect(row.locator(`[data-status="${code}"]`)).toHaveText(label);
      await expect(heading).toContainText('Presents: 1 · Absents: 0');
      expect(state.corrections.at(-1).payload.correction.after).toEqual({ status: code, entry: '', exit: '', breakMinutes: 0 });
      await page.reload();
      await expect(row.locator(`[data-status="${code}"]`)).toHaveText(label);
      await expect(heading).toContainText('Absents: 0');
      const filter = page.locator('.daily-import__filter select').first();
      await filter.selectOption(code);
      await expect(page.locator('.daily-import__week-table tbody tr')).toHaveCount(1);
      await filter.selectOption('ALL');
      if (code === 'CSS' && width === 1500) {
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Télécharger Excel' }).click();
        const download = await downloaded;
        const book = XLSX.read(await readFile(await download.path()), { type: 'buffer' });
        const cells = XLSX.utils.sheet_to_json(book.Sheets.Pointage, { header: 1 });
        expect(cells.find((cells) => cells.includes('Leave fixture'))).toContain('Congé sans solde');
      }
      if (code === 'CSS') {
        await page.locator('.mod-export-button--topbar input[type=file]').setInputFiles({
          name: 'leave.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: sourceBuffer,
        });
        await expect(page.locator('.daily-import')).toContainText('Import sauvegardé');
        await page.reload();
        await expect(row.locator('[data-status="CSS"]')).toHaveText('Congé sans solde');
        await expect(heading).toContainText('Presents: 1 · Absents: 0');
      }
      await row.getByRole('button').click();
      await expect(status).toHaveValue(code);
      await page.clock.runFor(1000);
    }
    await status.selectOption('POINTAGE');
    await expect(dialog.getByLabel('Pause déduite (min)', { exact: true })).toHaveValue('24');
    await dialog.getByLabel(/^Entrée/).fill('08:00');
    await dialog.getByLabel(/^Sortie/).fill('16:00');
    await dialog.getByLabel('Code RH', { exact: true }).fill('123X');
    await dialog.getByRole('button', { name: 'Enregistrer la correction' }).click();
    await expect(row.locator('[data-status="POINTAGE"]')).toBeVisible();
    await expect(heading).toContainText('Presents: 2 · Absents: 0');
    await page.reload();
    await expect(row.locator('[data-status="POINTAGE"]')).toBeVisible();
    await page.locator('.mod-export-button--topbar input[type=file]').setInputFiles({
      name: 'leave.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: sourceBuffer,
    });
    await expect(page.locator('.daily-import')).toContainText('Import sauvegardé');
    await page.reload();
    await expect(row.locator('[data-status="ABS"]')).toBeVisible();
    await expect(heading).toContainText('Presents: 1 · Absents: 1');
    expect(errors).toEqual([]);
  });
}
