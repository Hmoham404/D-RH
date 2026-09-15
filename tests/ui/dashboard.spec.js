import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { prepareDailyPointage } from '../../src/lib/dailyPointage.js';

const employees = Array.from({ length: 30 }, (_, i) => ({
  recordId: `test-${i + 1}`, id: String(i + 1), zk: String(i + 1),
  fullName: `Employé Démonstration ${String(i + 1).padStart(2, '0')}`,
  department: i < 24 ? ['Production - Injection', 'Production - Assemblage', 'Production - Sérigraphie'][i % 3] : 'Administration',
  kind: i % 4 ? 'MOD' : 'MOI', status: 'Actif', hiredAt: '2026-01-01',
}));
let snapshot;
test.beforeAll(async () => {
  const rows = [['ID Emp.', 'Nom', 'Temps du Ptg', 'Terminal']];
  for (let day = 9; day <= 15; day++) {
    for (let i = 0; i < 22; i++) {
      const employee = employees[i];
      rows.push([employee.id, employee.fullName, `09/${day}/2026 ${i % 5 === 0 ? '08:10' : '07:20'}`, 'Test']);
      if (i !== 0) rows.push([employee.id, employee.fullName, `09/${day}/2026 16:30`, 'Test']);
    }
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Pointage');
  snapshot = await prepareDailyPointage({ name: 'demo.xlsx', arrayBuffer: async () => XLSX.write(book, { type: 'array', bookType: 'xlsx' }) }, employees, null,
    { dateOrder: 'mdy', closeDays: true, breakMinutes: 0, roundingMinutes: 1 });
});
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-15T12:00:00Z') });
  // All database access is mocked. No live employee data or writes are used.
  await page.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const isDirectory = url.pathname.endsWith('/hr_staff_directory');
    const payload = isDirectory ? employees : url.searchParams.get('id')?.includes('rh-pointage-analysis')
      ? { payload: snapshot, updated_at: '2026-09-15T09:00:00Z' } : null;
    await route.fulfill({ json: payload });
  });
});

test('desktop navigation, attendance filters, correction and target editing', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ZK Dashboard' })).toBeVisible();
  await expect(page.locator('.daily-import .rh-table tbody tr')).toHaveCount(30);
  await expect(page.locator('body')).toHaveCSS('font-family', /Manrope/);
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.screenshot({ path: 'test-results/dashboard-preview.png' });
  await page.getByRole('combobox', { name: 'Statut', exact: true }).selectOption('ABS');
  await expect(page.locator('.daily-import .rh-table tbody tr')).toHaveCount(8);
  await page.getByRole('combobox', { name: 'Statut', exact: true }).selectOption('AVR');
  await expect(page.locator('.daily-import .rh-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.daily-import__time').first()).toHaveText('08:10');
  await page.getByRole('combobox', { name: 'Statut', exact: true }).selectOption('POINTAGE');
  await page.locator('.daily-import__time').first().click();
  await expect(page.getByRole('heading', { name: 'Correction RH' })).toBeVisible();
  await page.getByLabel('Heure de sortie').fill('');
  expect(await page.getByLabel('Heure de sortie').evaluate((el) => el.checkValidity())).toBe(true);
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.locator('.dashboard-gauges > div > button').click();
  await page.getByRole('spinbutton').fill('80');
  await page.getByRole('button', { name: 'Enregistrer l’objectif' }).click();
  await expect(page.locator('.dashboard-gauges')).toContainText('80');
  await page.locator('.attendance-chart select').selectOption('14');
  for (const label of ['Tableau de bord', 'Pointage quotidien', 'Employes', 'Departements', 'Rapports', 'Absences & Conges']) {
    await page.getByRole('navigation').getByRole('button', { name: new RegExp(label) }).click();
    await expect(page.locator('.rh-content')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (label === 'Employes') {
      await page.screenshot({ path: 'test-results/employees-desktop.png', fullPage: true });
      await page.locator('.admin-table .ghost-button').first().click();
      await expect(page.locator('.admin-modal__panel')).toBeVisible();
      await page.screenshot({ path: 'test-results/employee-form.png', fullPage: true });
      await page.locator('.admin-modal__actions .ghost-button').click();
    }
  }
  expect(errors).toEqual([]);
});

test('mobile layout, menu and translated navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.daily-import .rh-table tbody tr')).toHaveCount(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('.rh-sidebar')).toHaveClass(/is-open/);
  await page.getByRole('navigation').getByRole('button', { name: /Employes/ }).click();
  await expect(page.locator('.rh-sidebar')).not.toHaveClass(/is-open/);
  await expect(page.locator('.admin-table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.rh-language-switcher__button--ar').click();
  await expect(page.locator('.rh-main')).toHaveAttribute('dir', 'rtl');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
