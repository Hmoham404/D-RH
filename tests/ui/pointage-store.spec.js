import { test, expect } from '@playwright/test';

function snapshot() {
  return {
    importId: 'october-source', generatedAt: '2026-10-04T12:00:00.000Z',
    fileName: '1003.xlsx', sourceOnlyVersion: 1, dateNormalizationVersion: 6,
    calculationRules: { dateOrder: 'mdy', breakMinutes: 24 },
    rawRows: [1, 2, 3].map((day) => ({
      sourceId: '4', sourceName: 'Employe', employeeKey: '4', sheetName: 'Export',
      sourceDateValue: `10/0${day}/2026 07:36`,
      isoDate: `2026-10-0${day}`, pointageAt: `2026-10-0${day}T07:36:00`,
      pointageAtDisplay: `0${day}/10/2026 07:36:00`,
    })),
    closedDates: ['2026-10-01', '2026-10-02', '2026-10-03'],
    importDiagnostics: { incomingDates: ['2026-10-01', '2026-10-02', '2026-10-03'] },
    dayRows: [], dailySummaries: [], sourceWeeklySheets: [], weeklySheets: [],
  };
}

async function storageHarness(page) {
  const state = { current: null, history: [], writes: [], corruptRead: false };
  await page.route('**/store-test', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Pointage persistence test</title>',
  }));
  await page.route('**/rest/v1/hr_dashboard_store*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      const rows = Array.isArray(body) ? body : [body];
      state.writes.push({ method: 'POST', rows });
      for (const row of rows) {
        if (row.id === 'rh-pointage-analysis') state.current = structuredClone(row);
        else state.history.push(structuredClone(row));
      }
      await route.fulfill({ json: null });
      return;
    }
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      state.writes.push({ method: 'PATCH', rows: [body] });
      const expected = url.searchParams.get('updated_at')?.slice(3);
      if (!state.current || expected !== state.current.updated_at) {
        await route.fulfill({ json: [] });
        return;
      }
      state.current = { ...state.current, ...structuredClone(body) };
      await route.fulfill({ json: [{ payload: state.current.payload, updated_at: state.current.updated_at }] });
      return;
    }
    const data = state.current ? structuredClone(state.current) : null;
    if (data && state.corruptRead) data.payload.rawRows[0].isoDate = '2026-01-10';
    await route.fulfill({ json: data });
  });
  await page.goto('/store-test');
  return state;
}

test('database readback preserves October and source values across save/reload', async ({ page }) => {
  const state = await storageHarness(page);
  const result = await page.evaluate(async (input) => {
    const store = await import('/src/services/pointageSnapshotStore.js');
    // Real importer dayRows contain Date objects; SQL receives ISO strings.
    input.dayRows = [{ employeeKey: '4', isoDate: '2026-10-01',
      punches: [new Date('2026-10-01T07:36:00')], entry: '01/10/2026 07:36:00' }];
    const saved = await store.savePointageSnapshot(input);
    const reloaded = await store.loadPointageSnapshot();
    return { saved, reloaded };
  }, snapshot());
  expect(result.saved.mode).toBe('supabase');
  expect(result.saved.data.dayRows[0].punches[0]).toMatch(/^2026-10-01T/);
  expect(result.saved.data.rawRows.map((row) => row.isoDate)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  expect(result.reloaded.data.rawRows.map((row) => row.sourceDateValue)).toEqual([
    '10/01/2026 07:36', '10/02/2026 07:36', '10/03/2026 07:36',
  ]);
  expect(result.reloaded.data.storageRevision).toBe(state.current.updated_at);
  expect(result.reloaded.data.storageNeedsDateRepair).toBe(false);
  expect(state.current.payload).not.toHaveProperty('storageRevision');
  expect(state.current.payload).not.toHaveProperty('storageNeedsDateRepair');
});

test('automatic recalculation cannot overwrite a newer stored import', async ({ page }) => {
  const state = await storageHarness(page);
  const saved = await page.evaluate(async (input) => {
    const store = await import('/src/services/pointageSnapshotStore.js');
    return store.savePointageSnapshot(input);
  }, snapshot());
  state.current.updated_at = '2026-10-04T12:01:00.000Z';
  state.current.payload.fileName = 'nouvel-import.xlsx';
  const before = structuredClone(state.current);
  const historyCount = state.history.length;
  const result = await page.evaluate(async (input) => {
    const store = await import('/src/services/pointageSnapshotStore.js');
    return store.savePointageSnapshot({ ...input, calculationRules: { ...input.calculationRules, breakMinutes: 30 } },
      { expectedUpdatedAt: input.storageRevision });
  }, saved.data);
  expect(result.mode).toBe('conflict');
  expect(state.current).toEqual(before);
  expect(state.history).toHaveLength(historyCount);
  expect(state.writes.at(-1).method).toBe('PATCH');
});

test('recalculation updates only the revision that was loaded and verifies SQL readback', async ({ page }) => {
  const state = await storageHarness(page);
  const result = await page.evaluate(async (input) => {
    const store = await import('/src/services/pointageSnapshotStore.js');
    await store.savePointageSnapshot(input);
    const loaded = await store.loadPointageSnapshot();
    const recalculated = { ...loaded.data, calculationRules: { ...loaded.data.calculationRules, breakMinutes: 30 } };
    return store.savePointageSnapshot(recalculated, { expectedUpdatedAt: loaded.data.storageRevision });
  }, snapshot());
  expect(result.mode).toBe('supabase');
  expect(result.data.calculationRules.breakMinutes).toBe(30);
  expect(result.data.storageRevision).toBe(state.current.updated_at);
  expect(result.data.rawRows[0].sourceDateValue).toBe('10/01/2026 07:36');
  expect(state.writes.map((write) => write.method)).toEqual(['POST', 'PATCH', 'POST']);
  expect(state.current.payload).not.toHaveProperty('storageRevision');
});

test('reading an old SQL snapshot repairs preserved source dates and marks it for CAS publication', async ({ page }) => {
  const state = await storageHarness(page);
  const payload = snapshot();
  payload.rawRows[0].isoDate = '2026-01-10';
  payload.rawRows[0].pointageAt = '2026-01-10T07:36:00';
  payload.rawRows[0].pointageAtDisplay = '10/01/2026 07:36:00';
  state.current = { id: 'rh-pointage-analysis', payload, updated_at: '2026-10-04T11:59:00.000Z' };
  const loaded = await page.evaluate(async () => {
    const store = await import('/src/services/pointageSnapshotStore.js');
    return store.loadPointageSnapshot();
  });
  expect(loaded.mode).toBe('supabase');
  expect(loaded.data.rawRows[0].isoDate).toBe('2026-10-01');
  expect(loaded.data.storageNeedsDateRepair).toBe(true);
  expect(loaded.data.storageRevision).toBe(state.current.updated_at);
  expect(state.current.payload.rawRows[0].isoDate).toBe('2026-01-10');
  expect(state.writes).toHaveLength(0);
});

test('save reports failure when dates returned by SQL differ from requested dates', async ({ page }) => {
  const state = await storageHarness(page);
  state.corruptRead = true;
  const result = await page.evaluate(async (input) => {
    const store = await import('/src/services/pointageSnapshotStore.js');
    return store.savePointageSnapshot(input);
  }, snapshot());
  expect(result.mode).toBe('conflict');
  expect(result.data).toBeNull();
  expect(result.message).toContain('verification');
});

test('RH roster changes in generated weeks do not trigger date repairs while source dates do', async ({ page }) => {
  await storageHarness(page);
  const result = await page.evaluate(async (input) => {
    const { hasPointageDateChanges } = await import('/src/services/pointageSnapshotStore.js');
    input.weeklySheets = [{ dayColumns: [{ isoDate: '2026-10-01' }],
      rows: [{ employeeKey: '4', days: [{ isoDate: '2026-10-01', status: 'POINTAGE' }] }] }];
    const changedRoster = structuredClone(input);
    changedRoster.weeklySheets[0].rows.push({ employeeKey: 'new-directory-employee',
      days: [{ isoDate: '2026-10-01', status: 'ABS' }] });
    const changedSource = structuredClone(changedRoster);
    changedSource.rawRows[0].isoDate = '2026-01-10';
    const changedAxis = structuredClone(changedRoster);
    changedAxis.weeklySheets[0].dayColumns[0].isoDate = '2026-01-10';
    return {
      roster: hasPointageDateChanges(input, changedRoster),
      source: hasPointageDateChanges(input, changedSource),
      axis: hasPointageDateChanges(input, changedAxis),
    };
  }, snapshot());
  expect(result).toEqual({ roster: false, source: true, axis: true });
});
