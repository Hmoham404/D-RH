import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { expandPointageStorage } from '../src/lib/pointageStorage.js';

// Read-only by default. --write-existing exercises the application save path
// with unchanged source data, a backup, and a conditional server revision.
const writeExisting = process.argv.includes('--write-existing');
const observations = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const start = performance.now();
  const response = await originalFetch(url, { ...options, signal: AbortSignal.timeout(45000) });
  observations.push({ method: options.method || 'GET', ms: Math.round(performance.now() - start),
    status: response.status, requestBytes: typeof options.body === 'string' ? Buffer.byteLength(options.body) : 0 });
  return response;
};
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
try {
  const env = loadEnv('development', process.cwd(), '');
  const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const store = await server.ssrLoadModule('/src/services/pointageSnapshotStore.js');
  const loaded = await store.loadPointageSnapshot();
  assert.equal(loaded.mode, 'supabase');
  assert.equal(loaded.data.storageNeedsDateRepair, false, 'Resolve source-date repairs before this storage check.');
  if (writeExisting) {
    const historyId = `rh-pointage-history-${loaded.data.importId}`;
    const { data: backup, error } = await db.from('hr_dashboard_store').select('id,payload,updated_at')
      .in('id', ['rh-pointage-analysis', historyId]);
    if (error) throw error;
    await mkdir('.pointage-backups', { recursive: true });
    await writeFile(`.pointage-backups/timeout-verification-${Date.now()}.json`, JSON.stringify(backup));
    const before = backup.find((row) => row.id === 'rh-pointage-analysis');
    before.payload = expandPointageStorage(before.payload);
    assert.equal(before.updated_at, loaded.data.storageRevision);
    const fields = ['rawRows', 'dayRows', 'manualCorrections', 'sourceWeeklySheets'];
    for (const field of fields) assert.deepEqual(loaded.data[field], before.payload[field]);
    observations.length = 0;
    const result = await store.savePointageSnapshot(loaded.data, { expectedUpdatedAt: loaded.data.storageRevision });
    console.log(JSON.stringify({ mode: result.mode, historySaveFailed: result.historySaveFailed,
      message: result.message, observations }));
    assert.equal(result.mode, 'supabase');
    assert.equal(result.historySaveFailed, false);
    const reloaded = await store.loadPointageSnapshot();
    for (const field of fields) assert.deepEqual(reloaded.data[field], before.payload[field]);
    const history = await db.from('hr_dashboard_store').select('payload').eq('id', historyId).single();
    if (history.error) throw history.error;
    const archived = expandPointageStorage(history.data.payload);
    for (const field of [...fields, 'currentFilePointage']) assert.deepEqual(archived[field], loaded.data[field]);
  }
  console.log(JSON.stringify({ verified: true, writeExisting, punches: loaded.data.rawRows.length,
    dates: [...new Set(loaded.data.rawRows.map((row) => row.isoDate))].sort() }));
} finally {
  await server.close();
  globalThis.fetch = originalFetch;
}
