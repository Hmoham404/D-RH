import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { preparePayrollPointage } from '../../src/lib/payrollPointage.js';

const staff = [
  { id: '1', fullName: 'MOD PERMANENT', status: 'Actif' },
  { id: '2', fullName: 'MOD DEPART', status: 'STC', inactiveFrom: '29/10/2026' },
  { id: '3', fullName: 'MOD RECRUE', status: 'Actif', hiredAt: '30/10/2026' },
  { id: '4', fullName: 'MOI PRODUCTION', status: 'Actif', kind: 'MOI' },
  { id: '5', fullName: 'MOD ADMINISTRATION', status: 'Actif', department: 'ADMINISTRATION' },
  { id: '6', fullName: 'MOD SANS PASSAGE', status: 'Actif', hiredAt: '' },
  { id: '7', fullName: 'MOD FUTUR', status: 'Actif', hiredAt: '01/11/2026' },
  { id: '8', fullName: 'STC SANS DATE', status: 'STC' },
].map((employee) => ({ recordId: `history-${employee.id}`, zk: employee.id,
  department: 'PRODUCTION', kind: 'MOD', hiredAt: '01/01/2026', ...employee }));

async function prepare(page, employees = staff) {
  await page.clock.install({ time: new Date('2026-10-30T12:00:00Z') });
  const rows = [['ID Emp.', 'Nom', 'Temps du Ptg']];
  for (const date of ['10/27/2026', '10/29/2026', '10/30/2026']) {
    rows.push([employees[0].id, employees[0].fullName, `${date} 08:00`],
      [employees[0].id, employees[0].fullName, `${date} 17:00`]);
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Pointage');
  const snapshot = await preparePayrollPointage({ name: 'history.xlsx',
    arrayBuffer: async () => XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) },
  employees, null, { dateOrder: 'mdy', closeDays: true, breakMinutes: 24, roundingMinutes: 1 }, '2026-10-30');
  await page.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const id = url.searchParams.get('id') || '';
    if (url.pathname.endsWith('/hr_staff_directory')) return route.fulfill({ json: employees });
    if (id === 'eq.rh-staff-directory-active-records') return route.fulfill({ json: {
      payload: { recordIds: employees.map((employee) => employee.recordId) },
    } });
    if (id === 'eq.rh-pointage-analysis') return route.fulfill({ json: {
      payload: snapshot, updated_at: '2026-10-30T10:00:00Z',
    } });
    return route.fulfill({ json: id.startsWith('like.') ? [] : null });
  });
  await page.goto('/');
  await expect(page.locator('#daily-analysis-date')).toHaveValue('2026-10-30');
}

const card = (page) => page.locator('.mod-metric').filter({ hasText: 'Totale de MOD Actif' });

test('MOD workforce and its list follow J-1, J-3, and today independently of punches and current status', async ({ page }) => {
  await prepare(page);
  await expect(card(page).locator('strong')).toHaveText('3');
  await page.locator('#daily-analysis-date').selectOption('2026-10-29');
  await expect(card(page).locator('strong')).toHaveText('2');
  await page.locator('#daily-analysis-date').selectOption('2026-10-27');
  await expect(card(page).locator('strong')).toHaveText('3');
  await card(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('tbody tr')).toHaveCount(3);
  await expect(dialog).toContainText('MOD DEPART');
  await expect(dialog).toContainText('MOD SANS PASSAGE');
  await expect(dialog.locator('tbody tr').filter({ hasText: 'MOD DEPART' })).toContainText('Actif');
  for (const name of ['MOD RECRUE', 'MOI PRODUCTION', 'MOD ADMINISTRATION', 'MOD FUTUR', 'STC SANS DATE']) {
    await expect(dialog).not.toContainText(name);
  }
  await dialog.locator('.rh-modal__close').click();
  await page.locator('#daily-analysis-date').selectOption('2026-10-30');
  await expect(card(page).locator('strong')).toHaveText('3');
  await card(page).click();
  await expect(dialog).toContainText('MOD RECRUE');
  await expect(dialog).not.toContainText('MOD DEPART');
  await expect(dialog.getByRole('columnheader', { name: 'Entrée', exact: true })).toBeVisible();
  await dialog.locator('.rh-modal__close').click();
  await page.locator('.rh-kpi-card--blue').filter({ hasText: 'STC de la période' }).first().click();
  await expect(dialog.getByRole('columnheader', { name: 'Date de STC', exact: true })).toBeVisible();
  await expect(dialog.getByRole('columnheader', { name: /^(Entrée|Sortie|Retard)$/ })).toHaveCount(0);
  await expect(dialog.locator('tbody tr').filter({ hasText: 'MOD DEPART' }).locator('td').last()).toHaveText('29/10/2026');
  await dialog.screenshot({ path: 'test-results/stc-departure-date.png' });
  await dialog.locator('.rh-modal__close').click();
  await page.locator('.rh-kpi-card--blue').filter({ hasText: 'STC de la période' }).last().click();
  await expect(dialog.getByRole('columnheader', { name: 'Date de STC', exact: true })).toBeVisible();
});

test('zero active MOD does not fall back to the MOI production workforce', async ({ page }) => {
  await prepare(page, staff.filter((employee) => employee.kind === 'MOI'));
  await expect(card(page).locator('strong')).toHaveText('0');
  await card(page).click();
  await expect(page.getByRole('dialog')).not.toContainText('MOI PRODUCTION');
});

test('daily MOD chart shares the absence frame and full payroll axis with values limited to selected date minus one', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1100 });
  await prepare(page);
  const chart = page.locator('.mod-daily-presence-chart');
  await expect(chart).toHaveCount(0);
  const presenceRates = await page.locator('.mod-dashboard__rates').boundingBox();
  await page.getByRole('button', { name: 'Absentéisme', exact: true }).click();
  await expect(chart.getByRole('heading', { name: 'Effectif MOD actif jour par jour' })).toBeVisible();
  const absenceRates = await page.locator('.mod-dashboard__rates').boundingBox();
  const metrics = await page.locator('.mod-metric').first().boundingBox();
  expect(absenceRates.y).toBeCloseTo(presenceRates.y, 0);
  expect(absenceRates.y - (metrics.y + metrics.height)).toBeCloseTo(16, 0);
  await expect(chart.locator('footer time').first()).toHaveAttribute('datetime', '2026-10-26');
  await expect(chart.locator('footer time').last()).toHaveAttribute('datetime', '2026-11-25');
  await expect(chart).not.toContainText('J-1');
  await expect(chart.locator('circle')).toHaveCount(4);
  await expect(chart.getByRole('img')).toHaveAccessibleName(/26 oct\. : 3 MOD actifs/);
  await expect(chart.getByRole('img')).toHaveAccessibleName(/28 oct\. : 3 MOD actifs/);
  await expect(chart.getByRole('img')).toHaveAccessibleName(/29 oct\. : 2 MOD actifs/);
  await expect(chart.getByRole('img')).toHaveAccessibleName(/30 oct\. : Hors période analysée/);
  const frame = page.locator('.mod-presence-chart--with-daily');
  const absenceCurve = frame.locator(':scope > svg');
  await expect(frame.locator('.mod-chart-target-key strong')).toHaveText('5% – 5,5%');
  await expect(absenceCurve.locator('.mod-chart-target line')).toHaveCount(2);
  expect(Number(await absenceCurve.locator('.mod-chart-target__band').getAttribute('height'))).toBeGreaterThan(0);
  await expect(absenceCurve).toHaveAccessibleName(/2026-10-29:/);
  await expect(absenceCurve).toHaveAccessibleName(/2026-10-30: sans donnees/);
  await expect(absenceCurve).toHaveAccessibleName(/2026-11-25: sans donnees/);
  await expect(absenceCurve.locator('circle')).toHaveCount(2);
  await expect(absenceCurve.getByText('25 nov.', { exact: true })).toBeVisible();
  await expect(chart.getByRole('img').getByText('25 nov.', { exact: true })).toBeVisible();
  await expect(frame.locator(':scope > .mod-daily-presence-chart')).toHaveCount(1);
  await expect(chart).toHaveCSS('border-radius', '0px');
  const previous = await frame.locator(':scope > svg').boundingBox();
  const current = await chart.boundingBox();
  expect(current.y).toBeGreaterThanOrEqual(previous.y + previous.height);
  await page.locator('#daily-analysis-date').selectOption('2026-10-27');
  await expect(chart.locator('footer time').last()).toHaveAttribute('datetime', '2026-11-25');
  await expect(absenceCurve).toHaveAccessibleName(/2026-10-26:/);
  await expect(absenceCurve).toHaveAccessibleName(/2026-10-27: sans donnees/);
  await expect(absenceCurve.locator('circle')).toHaveCount(0);
  await expect(chart.locator('circle')).toHaveCount(1);
  await expect(chart.getByRole('img')).toHaveAccessibleName(/26 oct\. : 3 MOD actifs/);
  await page.locator('#daily-analysis-date').selectOption('2026-10-29');
  await expect(chart.locator('footer time').last()).toHaveAttribute('datetime', '2026-11-25');
  await expect(absenceCurve).toHaveAccessibleName(/2026-10-28:/);
  await expect(absenceCurve).toHaveAccessibleName(/2026-10-29: sans donnees/);
  await expect(absenceCurve.locator('circle')).toHaveCount(1);
  await expect(chart.locator('circle')).toHaveCount(3);
  await page.getByRole('button', { name: 'Présence', exact: true }).click();
  await expect(chart).toHaveCount(0);
  await page.getByRole('button', { name: 'Absentéisme', exact: true }).click();
  await expect(chart.locator('footer time').last()).toHaveAttribute('datetime', '2026-11-25');
  await page.locator('#daily-analysis-date').selectOption('2026-10-30');
  await expect(chart.locator('footer time').last()).toHaveAttribute('datetime', '2026-11-25');
  await expect(chart.locator('circle')).toHaveCount(4);
  await expect(chart).toBeVisible();
  await frame.screenshot({ path: 'test-results/daily-mod-presence-desktop.png' });
  await page.locator('.mod-dashboard__main').screenshot({ path: 'test-results/mod-dashboard-aligned.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await chart.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await frame.screenshot({ path: 'test-results/daily-mod-presence-mobile.png' });
  expect(errors).toEqual([]);
});
