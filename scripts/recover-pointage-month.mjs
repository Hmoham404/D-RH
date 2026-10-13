import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { isDeepStrictEqual } from 'node:util';
import { recoverMissingPayrollDays } from '../src/lib/pointageRecovery.js';
import { expandPointageStorage } from '../src/lib/pointageStorage.js';
import { normalizeSavedPointageSnapshot } from '../src/lib/dailyPointage.js';

// Explicit recovery of the two records audited for the missing October days.
// Preview by default; --apply saves only with the original current revision.
const source = JSON.parse(await readFile('.pointage-backups/month-recovery-source.json', 'utf8'));
const current = source.find((row) => row.id === 'rh-pointage-analysis');
const archive = source.find((row) => row.id === 'rh-pointage-history-20261010161429');
assert.ok(current && archive);
const env = loadEnv('development', process.cwd(), '');
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
try {
  const employeeStore = await server.ssrLoadModule('/src/services/employeeStore.js');
  const employeeLoader = employeeStore.loadEmployees;
  assert.equal(typeof employeeLoader, 'function');
  const roster = await employeeLoader();
  assert.equal(roster.mode, 'supabase');
  const original = expandPointageStorage(current.payload);
  const archived = expandPointageStorage(archive.payload);
  const recovery = recoverMissingPayrollDays(original, archived, roster.data, '2026-10-13');
  // Rebuild aggregates for the whole month using the latest pause setting;
  // retained per-person corrections continue to supply their own overrides.
  const rebuilt = await normalizeSavedPointageSnapshot({ ...recovery.snapshot, dateRebuildRequired: true }, roster.data, original.calculationRules.breakMinutes);
  rebuilt.rawRows = recovery.snapshot.rawRows;
  rebuilt.currentFilePointage.rawRows = recovery.snapshot.rawRows;
  const candidate = JSON.parse(JSON.stringify(rebuilt));
  const currentDates = new Set(original.rawRows.map((row) => row.isoDate));
  for (const field of ['rawRows', 'dayRows']) {
    assert.ok(isDeepStrictEqual(candidate[field].filter((row) => currentDates.has(row.isoDate)), original[field]), `${field}: recent data changed`);
  }
  assert.deepEqual(candidate.manualCorrections, recovery.snapshot.manualCorrections);
  const stamp = new Date().toISOString();
  candidate.generatedAt = stamp;
  candidate.importId = `month-recovery-${stamp.replace(/[^0-9]/g, '')}`;
  if (candidate.currentFilePointage) {
    candidate.currentFilePointage.generatedAt = stamp;
    candidate.currentFilePointage.importId = candidate.importId;
  }
  await writeFile('.pointage-backups/month-recovery-candidate.json', JSON.stringify(candidate));
  console.log(JSON.stringify({ restoredDates: recovery.restoredDates, punches: candidate.rawRows.length,
    dates: [...new Set(candidate.rawRows.map((row) => row.isoDate))].sort(), recentDaysUnchanged: true }));
  if (process.argv.includes('--apply')) {
    const { data: before, error } = await db.from('hr_dashboard_store').select('id,payload,updated_at')
      .in('id', [current.id, archive.id, 'rh-homepage', 'rh-bus-capacities']);
    if (error) throw error;
    assert.equal(before.find((r) => r.id === current.id)?.updated_at, current.updated_at, 'A newer import exists: abort recovery.');
    await writeFile(`.pointage-backups/month-recovery-before-${Date.now()}.json`, JSON.stringify(before));
    const store = await server.ssrLoadModule('/src/services/pointageSnapshotStore.js');
    const result = await store.savePointageSnapshot(candidate, { expectedUpdatedAt: current.updated_at });
    console.log(JSON.stringify({ mode: result.mode, historySaveFailed: result.historySaveFailed, message: result.message }));
    assert.equal(result.mode, 'supabase');
    assert.equal(result.historySaveFailed, false);
    const reloaded = await store.loadPointageSnapshot();
    assert.deepEqual(reloaded.data.rawRows, candidate.rawRows);
    const untouchedIds = before.filter((r) => r.id !== current.id).map((r) => r.id);
    const after = await db.from('hr_dashboard_store').select('id,payload,updated_at').in('id', untouchedIds);
    if (after.error) throw after.error;
    for (const row of after.data) assert.deepEqual(row, before.find((r) => r.id === row.id));
    console.log(JSON.stringify({ verified: true, unchangedOtherRecords: untouchedIds.length }));
  }
} finally { await server.close(); }
