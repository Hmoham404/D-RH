import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';

const clone = (value) => JSON.parse(JSON.stringify(value));
const employee = (id, name, exit = '') => ({
  record_id: `stc-${id}`, id, final_code: id, zk: id, full_name: name,
  department: 'PRODUCTION', service: 'INJ', kind: 'MOD', hired_at: '01/01/2026',
  status: id === '99' ? 'Actif' : 'STC', inactive_from: exit,
});
const staff = [
  employee('1', 'OUTSIDE SEPT25', '25/09/2026'),
  employee('2', 'DEPART SEPT29', '29/09/2026'),
  employee('3', 'DEPART OCT1', '01/10/2026'),
  employee('4', 'DEPART OCT2', '02/10/2026'),
  employee('5', 'DEPART OCT26', '26/10/2026'),
  employee('6', 'NO DATE'), employee('7', 'MONTH ONLY', 'OCT'), employee('99', 'ACTIVE'),
];

function upload(rows, name, formats = {}) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (const [cell, format] of Object.entries(formats)) sheet[cell].z = format;
  XLSX.utils.book_append_sheet(workbook, sheet, 'Export');
  return { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) };
}

function pointageUpload() {
  const rows = [['ID Emp.', 'Nom', 'Temps du Ptg']];
  for (const date of ['09/25/2026', '09/26/2026', '09/29/2026', '10/01/2026', '10/02/2026', '10/03/2026', '10/25/2026', '10/26/2026']) {
    rows.push([99, 'ACTIVE', `${date} 07:00`], [99, 'ACTIVE', `${date} 17:00`]);
  }
  return upload(rows, 'pointage.xlsx');
}

async function mockDatabase(page) {
  const tables = {
    hr_staff_directory: new Map(staff.map((row) => [row.record_id, clone(row)])),
    hr_dashboard_store: new Map(),
  };
  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const table = tables[url.pathname.split('/').pop()];
    if (!table) return route.fulfill({ json: [] });
    const key = url.pathname.endsWith('/hr_staff_directory') ? 'record_id' : 'id';
    const matches = (row) => [...url.searchParams.entries()].every(([field, filter]) => {
      if (!['id', 'record_id', 'updated_at'].includes(field)) return true;
      if (filter.startsWith('eq.')) return row[field] === filter.slice(3);
      if (filter.startsWith('neq.')) return row[field] !== filter.slice(4);
      if (filter.startsWith('in.')) return filter.slice(4, -1).split(',').map((part) => part.replace(/^"|"$/g, '')).includes(row[field]);
      if (filter.startsWith('like.')) return row[field].startsWith(filter.slice(5).replace(/%$/, ''));
      return true;
    });
    let rows = [...table.values()].filter(matches);
    const method = request.method();
    if (method === 'POST') {
      const body = request.postDataJSON();
      rows = (Array.isArray(body) ? body : [body]).map((row) => {
        const next = { ...table.get(row[key]), ...clone(row) };
        table.set(next[key], next);
        return next;
      });
    } else if (method === 'PATCH') {
      rows = rows.map((row) => {
        const next = { ...row, ...clone(request.postDataJSON()) };
        table.set(next[key], next);
        return next;
      });
    } else if (method === 'DELETE') {
      for (const row of rows) table.delete(row[key]);
    }
    const singular = request.headers().accept?.includes('object+json');
    await route.fulfill({ json: singular ? rows[0] || null : rows });
  });
  return tables;
}

async function navigate(page, title) {
  await page.locator('.rh-sidebar__item').filter({ has: page.locator('strong', { hasText: title }) }).click();
}

async function prepare(page) {
  await page.clock.install({ time: new Date('2026-10-04T12:00:00Z') });
  const tables = await mockDatabase(page);
  await page.goto('/');
  const input = page.locator('.mod-export-button--topbar input[type=file]');
  await expect(input).toBeEnabled();
  await input.setInputFiles(pointageUpload());
  await expect(page.locator('#daily-analysis-date')).toHaveValue('2026-10-26');
  await expect(input).toBeEnabled();
  return tables;
}

const stcCard = (page) => page.locator('.admin-stat-card').filter({ hasText: 'STC de la période' });

test('selected day controls dated STC cards and lists within the 26–25 period on every page', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepare(page);
  await page.locator('#daily-analysis-date').selectOption('2026-10-01');
  await expect(page.locator('.rh-kpi-card--blue').first().locator('strong')).toHaveText('2');
  await navigate(page, 'Employes');
  const picker = page.locator('.rh-topbar__date select');
  await expect(picker).toHaveValue('2026-10-01');
  await expect(stcCard(page).locator('strong')).toHaveText('2');
  await expect(stcCard(page)).toContainText('26/09/2026');
  await expect(stcCard(page)).toContainText('25/10/2026');
  await stcCard(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('DEPART SEPT29');
  await expect(dialog).toContainText('DEPART OCT1');
  for (const name of ['DEPART OCT2', 'OUTSIDE SEPT25', 'DEPART OCT26', 'NO DATE', 'MONTH ONLY']) {
    await expect(dialog).not.toContainText(name);
  }
  await dialog.locator('.rh-modal__close').click();
  await picker.selectOption('2026-10-02');
  await expect(stcCard(page).locator('strong')).toHaveText('3');
  await navigate(page, 'STC');
  const report = page.locator('.stc-dashboard');
  await expect(report).toContainText('DEPART OCT2');
  await expect(report.locator('tbody')).not.toContainText('DEPART OCT26');
  await page.locator('.rh-topbar__date select').selectOption('2026-10-26');
  await expect(report.locator('tbody')).toContainText('DEPART OCT26');
  await expect(report.locator('tbody')).not.toContainText('DEPART OCT1');
  await navigate(page, 'Employes');
  await expect(stcCard(page).locator('strong')).toHaveText('1');
  await expect(stcCard(page)).toContainText('26/10/2026');
  await expect(stcCard(page)).toContainText('25/11/2026');
  await navigate(page, 'ZK Dashboard');
  await expect(page.locator('#daily-analysis-date')).toHaveValue('2026-10-26');
  await expect(page.locator('.rh-kpi-card--blue').first().locator('strong')).toHaveText('1');
  await page.locator('#daily-analysis-date').selectOption('2026-10-01');
  await page.getByRole('button', { name: '30 min', exact: true }).click();
  await expect(page.locator('.mod-export-button--topbar input[type=file]')).toBeEnabled();
  await expect(page.locator('#daily-analysis-date')).toHaveValue('2026-10-01');
  await expect(page.locator('.rh-kpi-card--blue').first().locator('strong')).toHaveText('2');
  await page.reload();
  await navigate(page, 'Employes');
  await page.locator('.rh-topbar__date select').selectOption('2026-10-01');
  await expect(stcCard(page).locator('strong')).toHaveText('2');
  expect(errors).toEqual([]);
});

test('RH Excel native dates and status survive Supabase write and browser reload', async ({ page }) => {
  const tables = await prepare(page);
  await navigate(page, 'Employes');
  const serial = (month, day) => (Date.UTC(2026, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000;
  const rh = upload([
    ['Code', 'Nom', 'Departement', 'Statut', 'Actif/Inactif', 'Inactif A PARTIR DU'],
    ['21', 'IMPORTED SEPT29', 'PRODUCTION', 'Actif', 'STC', serial(9, 29)],
    ['22', 'IMPORTED OCT1', 'PRODUCTION', 'Actif', 'STC', serial(10, 1)],
    ['23', 'IMPORTED OCT2', 'PRODUCTION', 'Actif', 'STC', serial(10, 2)],
    ['24', 'IMPORTED NO DATE', 'PRODUCTION', 'Actif', 'STC', 0],
  ], 'personnel.xlsx', { F2: 'm/d/yy h:mm', F3: 'm/d/yy', F4: 'dd/mm/yyyy' });
  const input = page.locator('.admin-file-button input[type=file]');
  await input.setInputFiles(rh);
  await expect.poll(() => [...tables.hr_staff_directory.values()].filter((row) => row.final_code === '22').map((row) => row.inactive_from)).toEqual(['01/10/2026']);
  await expect(input).toBeEnabled();
  const imported = [...tables.hr_staff_directory.values()].filter((row) => ['21', '22', '23', '24'].includes(row.final_code));
  expect(imported.map((row) => row.inactive_from)).toEqual(['29/09/2026', '01/10/2026', '02/10/2026', '']);
  expect(imported.every((row) => row.status === 'STC')).toBe(true);
  await page.locator('.rh-topbar__date select').selectOption('2026-10-01');
  await expect(stcCard(page).locator('strong')).toHaveText('2');
  await page.reload();
  await navigate(page, 'Employes');
  await page.locator('.rh-topbar__date select').selectOption('2026-10-01');
  await expect(stcCard(page).locator('strong')).toHaveText('2');
  await page.locator('.rh-topbar__date select').selectOption('2026-10-02');
  await expect(stcCard(page).locator('strong')).toHaveText('3');
});
