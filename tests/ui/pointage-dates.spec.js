import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { expandPointageStorage } from '../../src/lib/pointageStorage.js';

const CURRENT_ID = 'rh-pointage-analysis';
const EXPECTED_DATES = ['2026-10-01', '2026-10-02', '2026-10-03'];
const employees = [{
  record_id: 'date-test-4', id: '4', zk: '4', full_name: 'Date fixture',
  department: 'PRODUCTION', service: 'INJ', kind: 'MOD', status: 'Actif',
  hired_at: '2026-01-01',
}];
const clone = (value) => JSON.parse(JSON.stringify(value));

function excelSerial(month, day, hour, minute, second) {
  return (Date.UTC(2026, month - 1, day, hour, minute, second) - Date.UTC(1899, 11, 30)) / 86400000;
}

function dateUpload(kind) {
  const rows = [['ID Emp.', 'Nom', 'Temps du Ptg', 'Terminal']];
  const originalValues = [];
  for (const day of [1, 2, 3]) {
    for (const [hour, minute, second] of [[7, 36, 17], [17, 51, 12]]) {
      const value = kind === 'text'
        ? `10/${String(day).padStart(2, '0')}/2026 ${String(hour).padStart(2, '0')}:${minute}`
        : ['numeric-dmy-display', 'numeric-localized-display'].includes(kind)
          ? excelSerial(day, 10, hour, minute, second)
          : excelSerial(10, day, hour, minute, second);
      originalValues.push(value);
      rows.push([4, 'Date fixture', value, 'Fixture terminal']);
    }
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if (kind !== 'text') {
    for (let index = 0; index < originalValues.length; index++) {
      sheet[`C${index + 2}`].z = kind === 'numeric-dmy-display'
        ? 'dd/mm/yyyy hh:mm' : kind === 'numeric-localized-display'
          ? 'm/d/yy h:mm' : 'mm/dd/yyyy hh:mm';
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Export');
  return {
    originalValues,
    // This name must never decide the calendar dates inside the workbook.
    file: { name: '1003.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) },
  };
}

async function mockDatabase(page) {
  const protectedRecords = [
    { id: 'rh-homepage', payload: {}, updated_at: '2026-01-01T00:00:00Z' },
    { id: 'rh-bus-capacities', payload: { capacities: { 'OTHER BUS': 12 } }, updated_at: '2026-01-01T00:00:00Z' },
    { id: 'other-project-data', payload: { untouched: true }, updated_at: '2026-01-01T00:00:00Z' },
  ];
  const records = new Map(protectedRecords.map((record) => [record.id, clone(record)]));
  const writes = [];
  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname.endsWith('/hr_staff_directory')) {
      await route.fulfill({ json: employees });
      return;
    }
    const idFilter = url.searchParams.get('id') || '';
    const matches = (record) => {
      if (idFilter.startsWith('eq.') && record.id !== idFilter.slice(3)) return false;
      if (idFilter.startsWith('like.') && !record.id.startsWith(idFilter.slice(5).replace(/%$/, ''))) return false;
      const differentId = url.searchParams.getAll('id').find((value) => value.startsWith('neq.'));
      if (differentId && record.id === differentId.slice(4)) return false;
      const updatedAt = url.searchParams.get('updated_at');
      return !updatedAt?.startsWith('eq.') || record.updated_at === updatedAt.slice(3);
    };
    if (method === 'GET') {
      const rows = [...records.values()].filter(matches);
      const json = idFilter.startsWith('eq.') ? rows[0] || null : rows;
      await route.fulfill({ json });
      return;
    }

    const body = request.postData() ? request.postDataJSON() : null;
    writes.push({ method, body: clone(body), url: request.url() });
    let changed = [];
    if (method === 'POST') {
      for (const record of Array.isArray(body) ? body : [body]) {
        const next = { ...records.get(record.id), ...clone(record) };
        records.set(record.id, next);
        changed.push(next);
      }
    } else if (method === 'PATCH') {
      for (const record of [...records.values()].filter(matches)) {
        const next = { ...record, ...clone(body) };
        records.set(record.id, next);
        changed.push(next);
      }
    } else if (method === 'DELETE') {
      changed = [...records.values()].filter(matches);
      for (const record of changed) records.delete(record.id);
    }
    const singular = request.headers().accept?.includes('object+json');
    await route.fulfill({ json: singular ? changed[0] || null : changed });
  });
  return {
    get snapshot() { return expandPointageStorage(records.get(CURRENT_ID)?.payload); },
    get protectedRecords() { return protectedRecords.map((record) => records.get(record.id)); },
    originalProtectedRecords: clone(protectedRecords),
    records,
    writes,
  };
}

test('current payroll month shows every calendar day and preserves other projects during import and clear', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-10-13T12:00:00Z') });
  const database = await mockDatabase(page);
  await page.goto('/');
  const upload = dateUpload('text');
  await page.locator('.mod-export-button--topbar input[type=file]').setInputFiles(upload.file);
  const month = page.locator('.daily-import__month-bar');
  await expect(month).toHaveAttribute('data-period-start', '2026-09-26');
  await expect(month).toHaveAttribute('data-period-end', '2026-10-25');
  await expect(month).toContainText('3 / 18');
  const columns = page.locator('.daily-import th[data-date]');
  await expect(columns).toHaveCount(18);
  await expect(columns.first()).toHaveAttribute('data-date', '2026-09-26');
  await expect(columns.last()).toHaveAttribute('data-date', '2026-10-13');
  const weeks = page.locator('.daily-import__week');
  await expect(weeks).toHaveCount(4);
  for (const [index, count] of [2, 7, 7, 2].entries()) {
    await expect(weeks.nth(index).locator('th[data-date]')).toHaveCount(count);
  }
  await expect(page.locator('th[data-date="2026-10-11"] button')).toBeDisabled();
  await expect(page.locator('th[data-date="2026-10-11"]')).toContainText('Non importé');
  await expect(page.locator('#daily-analysis-date option')).toHaveCount(3);
  const chart = page.locator('.mod-presence-chart');
  const quarterTab = chart.getByRole('button', { name: '3 mois', exact: true });
  const monthTab = chart.getByRole('button', { name: 'Mois actuel', exact: true });
  const weekTab = chart.getByRole('button', { name: 'Semaine actuelle', exact: true });
  await expect(quarterTab).toHaveAttribute('aria-pressed', 'true');
  await monthTab.click();
  await expect(monthTab).toHaveAttribute('aria-pressed', 'true');
  await expect(chart).toContainText('S1');
  await weekTab.click();
  await expect(weekTab).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.locator('svg[role="img"]')).toContainText('lun.');
  await quarterTab.click();
  await expect(quarterTab).toHaveAttribute('aria-pressed', 'true');
  await chart.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('daily-payroll-chart.png') });
  await page.reload();
  await expect(columns).toHaveCount(18);
  await expect(month).toContainText('3 / 18');
  expect(database.protectedRecords).toEqual(database.originalProtectedRecords);
  await page.locator('.daily-import__month-bar').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('current-payroll-month.png') });
  const historyIds = [...database.records.keys()].filter((id) => id.startsWith('rh-pointage-history-'));
  expect(historyIds.length).toBe(0);
  const historyBefore = historyIds.map((id) => clone(database.records.get(id)));
  const cleared = await page.evaluate(async () => {
    const store = await import('/src/services/pointageSnapshotStore.js');
    return store.clearPointageSnapshot();
  });
  expect(cleared.mode).toBe('supabase');
  expect(historyIds.map((id) => database.records.get(id))).toEqual(historyBefore);
  expect(database.protectedRecords).toEqual(database.originalProtectedRecords);
  for (const write of database.writes) {
    const url = new URL(write.url);
    expect(url.pathname).toBe('/rest/v1/hr_dashboard_store');
    if (write.method === 'POST') {
      for (const record of Array.isArray(write.body) ? write.body : [write.body]) {
        expect(record.id === CURRENT_ID || record.id.startsWith('rh-pointage-history-')).toBe(true);
      }
    } else {
      expect(url.searchParams.get('id')).toMatch(/^eq\.rh-pointage-(analysis$|history-)/);
    }
  }
});

test('the 26th empties the stored current pointage without touching other projects', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
  const database = await mockDatabase(page);
  await page.goto('/');
  await page.locator('.mod-export-button--topbar input[type=file]').setInputFiles(dateUpload('text').file);
  await expect(page.locator('.daily-import__month-bar')).toContainText('3 / 30');
  const saved = clone(database.snapshot);
  const writesBefore = database.writes.length;
  await page.clock.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  await page.reload();
  await expect(page.locator('.daily-import__month-bar')).toHaveAttribute('data-period-start', '2026-10-26');
  await expect(page.locator('.daily-import__month-bar')).toHaveAttribute('data-period-end', '2026-11-25');
  await expect(page.locator('.daily-import__month-bar')).toContainText('0 / 1');
  await expect(page.locator('#daily-analysis-date')).toBeDisabled();
  await expect(page.locator('.daily-import .rh-table__empty')).toContainText('mois de paie en cours');
  expect(saved.rawRows.length).toBeGreaterThan(0);
  expect(database.snapshot.rawRows).toEqual([]);
  expect(database.snapshot.payrollPeriodStart).toBe('2026-10-26');
  expect(database.writes.length).toBeGreaterThan(writesBefore);
  expect(database.protectedRecords).toEqual(database.originalProtectedRecords);
  const staleSave = await page.evaluate(async (old) => {
    const store = await import('/src/services/pointageSnapshotStore.js');
    return store.savePointageSnapshot(old);
  }, saved);
  expect(staleSave.mode).toBe('conflict');
  expect(database.snapshot.rawRows).toEqual([]);
});

test('an open page empties the previous cycle at midnight on the 26th', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
  const database = await mockDatabase(page);
  await page.goto('/');
  await page.locator('.mod-export-button--topbar input[type=file]').setInputFiles(dateUpload('text').file);
  await expect(page.locator('.daily-import__month-bar')).toContainText('3 / 30');
  await page.clock.fastForward(13 * 60 * 60 * 1000);
  await expect(page.locator('.daily-import__month-bar')).toHaveAttribute('data-period-start', '2026-10-26');
  await expect.poll(() => database.snapshot.rawRows.length).toBe(0);
  expect(database.protectedRecords).toEqual(database.originalProtectedRecords);
});

function sourceMetadata(snapshot) {
  return snapshot.rawRows.map((row) => ({
    isoDate: row.isoDate,
    pointageAt: row.pointageAt,
    sourceDateValue: row.sourceDateValue,
    sourceDateText: row.sourceDateText,
    sourceDateFormat: row.sourceDateFormat,
    sourceDateEncoding: row.sourceDateEncoding,
    sourceDateIso: row.sourceDateIso,
  }));
}

async function expectOctoberPicker(page) {
  const picker = page.locator('#daily-analysis-date');
  await expect(picker.locator('option')).toHaveCount(EXPECTED_DATES.length);
  for (const [index, date] of EXPECTED_DATES.entries()) {
    await expect(picker.locator('option').nth(index)).toHaveAttribute('value', date);
  }
  await expect(picker).toHaveValue('2026-10-03');
  await expect(picker.locator('option:checked')).toHaveText('03 oct 2026');
  await expect(page.locator('.mod-period-picker--topbar small')).toContainText('sept. 2026');
  await expect(page.locator('.mod-period-picker--topbar small')).toContainText('oct. 2026');
}

for (const kind of ['text', 'numeric-dmy-display', 'numeric-mdy-display', 'numeric-localized-display']) {
  test(`October MDY dates survive SQL reload and pause recalculation (${kind})`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-04T12:00:00Z') });
    const database = await mockDatabase(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const upload = dateUpload(kind);

    await page.goto('/');
    const importInput = page.locator('.mod-export-button--topbar input[type=file]');
    await expect(importInput).toBeEnabled();
    await importInput.setInputFiles(upload.file);
    await expectOctoberPicker(page);
    await expect(importInput).toBeEnabled();
    expect(database.snapshot.fileName).toBe('1003.xlsx');
    expect(database.snapshot.calculationRules.dateOrder).toBe('mdy');
    expect(database.snapshot.rawRows.map((row) => row.sourceDateValue)).toEqual(upload.originalValues);
    expect(database.snapshot.rawRows.map((row) => row.isoDate)).toEqual(EXPECTED_DATES.flatMap((date) => [date, date]));
    for (const [index, row] of database.snapshot.rawRows.entries()) {
      const day = Math.floor(index / 2) + 1;
      if (kind === 'numeric-localized-display') {
        // Excel's built-in format 22 renders regionally. SheetJS preserves its
        // US text here, while the supplied source export displays 10/01-10/03.
        expect(row.sourceDateText).toContain(`${day}/10/26`);
      } else {
        expect(row.sourceDateText).toContain(`10/${String(day).padStart(2, '0')}/2026`);
      }
      expect(row.sourceDateIso).toBe(row.pointageAt);
      expect(row.sourceDateEncoding).toBe(kind === 'text' ? 'mdy-text'
        : kind === 'numeric-dmy-display' ? 'excel-visible-mdy'
          : kind === 'numeric-localized-display' ? 'excel-localized-mdy' : 'excel-serial');
      if (kind !== 'text') {
        expect(row.pointageAt).toMatch(index % 2 === 0 ? /T07:36:17$/ : /T17:51:12$/);
        expect(row.sourceDateFormat).toBe(kind === 'numeric-dmy-display'
          ? 'dd/mm/yyyy hh:mm' : kind === 'numeric-localized-display'
            ? 'm/d/yy h:mm' : 'mm/dd/yyyy hh:mm');
      }
    }
    const originalMetadata = clone(sourceMetadata(database.snapshot));
    expect(sourceMetadata(database.snapshot.currentFilePointage)).toEqual(originalMetadata);

    for (let reload = 0; reload < 2; reload++) {
      await page.reload();
      await expectOctoberPicker(page);
      await expect(importInput).toBeEnabled();
      expect(sourceMetadata(database.snapshot)).toEqual(originalMetadata);
      expect(sourceMetadata(database.snapshot.currentFilePointage)).toEqual(originalMetadata);
    }

    const writesBeforePause = database.writes.length;
    await page.getByRole('button', { name: '30 min', exact: true }).click();
    await expect.poll(() => database.snapshot?.calculationRules?.breakMinutes).toBe(30);
    await expect(importInput).toBeEnabled();
    await expectOctoberPicker(page);
    expect(database.writes.length).toBeGreaterThan(writesBeforePause);
    expect(sourceMetadata(database.snapshot)).toEqual(originalMetadata);
    expect(sourceMetadata(database.snapshot.currentFilePointage)).toEqual(originalMetadata);

    await page.reload();
    await expectOctoberPicker(page);
    await expect(importInput).toBeEnabled();
    expect(database.snapshot.calculationRules.breakMinutes).toBe(30);
    expect(sourceMetadata(database.snapshot)).toEqual(originalMetadata);
    expect(errors).toEqual([]);
  });
}
