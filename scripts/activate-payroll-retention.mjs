import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import { createServer, loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { canonicalizePointageSnapshotDates } from '../src/lib/pointageSnapshotDates.js';
import { getCurrentFilePointage, normalizeSavedPointageSnapshot } from '../src/lib/dailyPointage.js';
import { getPayrollPeriod, payrollPeriodToDate, pointageInPeriod } from '../src/lib/pointagePeriod.js';
import { getLocalPointageDate } from '../src/lib/pointageDates.js';
import { PAYROLL_RETENTION } from '../src/lib/payrollPointage.js';

// Preview makes a local full backup. Apply requires that exact reviewed plan,
// refuses concurrent changes and mutates only exact pointage record IDs.
const args = process.argv.slice(2);
const today = getLocalPointageDate();
const period = payrollPeriodToDate(getPayrollPeriod(today), today);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const env = loadEnv('development', process.cwd(), '');
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(45000) }) } });
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
const dates = (data) => [...new Set([...(data?.rawRows || []).map((row) => row.isoDate),
  ...(data?.sourceWeeklySheets || []).flatMap((s) => s.dayColumns.map((d) => d.isoDate))])].sort();
try {
  if (!args.includes('--apply')) {
    const records = [];
    for (let offset = 0; ; offset += 10) {
      const { data, error } = await db.from('hr_dashboard_store').select('id,payload,updated_at')
        .or('id.eq.rh-pointage-analysis,id.like.rh-pointage-history-%').order('id').range(offset, offset + 9);
      if (error) throw error;
      records.push(...data);
      if (data.length < 10) break;
    }
    const current = records.find((r) => r.id === 'rh-pointage-analysis');
    assert.ok(current && !current.payload.cleared, 'No current month to preserve.');
    const canonical = canonicalizePointageSnapshotDates(current.payload);
    const view = pointageInPeriod(getCurrentFilePointage(canonical), period);
    const retained = new Set(dates(view));
    assert.ok(retained.size, 'Current month is empty: recover before cleaning archives.');
    const missing = new Set();
    for (const archive of records.filter((r) => r.id !== current.id && !r.payload.cleared)) {
      const payload = canonicalizePointageSnapshotDates(archive.payload);
      if (payload.dateRebuildRequired || payload.currentFilePointage?.dateRebuildRequired) continue;
      dates(pointageInPeriod(getCurrentFilePointage(payload), period)).forEach((d) => { if (!retained.has(d)) missing.add(d); });
    }
    assert.equal(missing.size, 0, `Recover archived days first: ${[...missing].sort().join(', ')}`);
    const employees = await (await server.ssrLoadModule('/src/services/employeeStore.js')).loadEmployees();
    assert.equal(employees.mode, 'supabase');
    const candidate = await normalizeSavedPointageSnapshot({ ...canonical, ...view,
      currentFilePointage: { ...view, dateRebuildRequired: true }, dateRebuildRequired: true }, employees.data, view.calculationRules.breakMinutes);
    candidate.retentionPolicy = PAYROLL_RETENTION;
    candidate.payrollPeriodStart = period.start;
    candidate.closedDates = dates(candidate).filter((d) => d < today);
    candidate.currentFilePointage = { ...candidate, currentFilePointage: undefined };
    assert.deepEqual(candidate.rawRows.map((r) => [r.sourceId, r.pointageAt]).sort(), view.rawRows.map((r) => [r.sourceId, r.pointageAt]).sort(), 'Source punches changed.');
    await mkdir('.pointage-backups', { recursive: true });
    const stem = `.pointage-backups/payroll-activation-${Date.now()}`;
    const serialized = JSON.stringify({ records, candidate });
    await writeFile(`${stem}-backup.json`, serialized);
    const plan = { today, periodStart: period.start, backup: resolve(`${stem}-backup.json`), sha256: hash(serialized),
      currentRevision: current.updated_at, keptDays: dates(candidate), keptPunches: candidate.rawRows.length,
      archiveCount: records.length - 1, jsonBytesBefore: records.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r.payload)), 0) };
    await writeFile(`${stem}-plan.json`, JSON.stringify(plan, null, 2));
    console.log(JSON.stringify({ planFile: `${stem}-plan.json`, ...plan }));
  } else {
    const planFile = resolve(args[args.indexOf('--apply') + 1]);
    const root = resolve('.pointage-backups');
    assert.ok(!relative(root, planFile).startsWith('..') && !isAbsolute(relative(root, planFile)));
    const plan = JSON.parse(await readFile(planFile, 'utf8'));
    assert.equal(plan.today, today, 'Plan expired; generate a fresh preview.');
    assert.ok(!relative(root, resolve(plan.backup)).startsWith('..') && !isAbsolute(relative(root, resolve(plan.backup))));
    const serialized = await readFile(plan.backup, 'utf8');
    assert.equal(hash(serialized), plan.sha256);
    const { records, candidate: planned } = JSON.parse(serialized);
    const store = await server.ssrLoadModule('/src/services/pointageSnapshotStore.js');
    const latest = await db.from('hr_dashboard_store').select('id,payload,updated_at').eq('id', 'rh-pointage-analysis').single();
    if (latest.error) throw latest.error;
    let candidate = planned;
    if (latest.data.updated_at !== plan.currentRevision) {
      // Rebase only when the latest snapshot already contains exclusively this
      // cycle and all planned dates. Keep its data/calculations verbatim.
      const fresh = canonicalizePointageSnapshotDates(latest.data.payload);
      assert.ok(!fresh.dateRebuildRequired && !fresh.currentFilePointage?.dateRebuildRequired, 'Latest snapshot needs a date repair.');
      const freshDates = dates(getCurrentFilePointage(fresh));
      assert.ok(freshDates.every((d) => d >= period.start && d <= period.end));
      assert.ok(plan.keptDays.every((d) => freshDates.includes(d)), 'Latest import lost a day: stop before cleanup.');
      candidate = { ...fresh, retentionPolicy: PAYROLL_RETENTION, payrollPeriodStart: period.start };
      candidate.currentFilePointage = { ...candidate, currentFilePointage: undefined };
      await writeFile(`${plan.backup}.latest-${Date.now()}.json`, JSON.stringify(latest.data));
    }
    const saved = await store.savePointageSnapshot(candidate, { expectedUpdatedAt: latest.data.updated_at });
    if (saved.mode === 'conflict') {
      const after = await db.from('hr_dashboard_store').select('updated_at').eq('id', 'rh-pointage-analysis').single();
      console.log(JSON.stringify({ expectedRevision: latest.data.updated_at, observedRevision: after.data?.updated_at, reason: saved.message }));
    }
    assert.equal(saved.mode, 'supabase', saved.message);
    let deleted = 0, emptied = 0;
    for (const record of records.filter((r) => r.id !== 'rh-pointage-analysis')) {
      assert.match(record.id, /^rh-pointage-history-[a-zA-Z0-9_-]+$/);
      assert.ok(record.updated_at);
      // Never erase a row that another client has changed since the backup.
      const removed = await db.from('hr_dashboard_store').delete().eq('id', record.id).eq('updated_at', record.updated_at).select('id');
      if (removed.error) throw removed.error;
      const remaining = await db.from('hr_dashboard_store').select('id,payload,updated_at').eq('id', record.id).maybeSingle();
      if (remaining.error) throw remaining.error;
      if (!remaining.data) { deleted++; continue; }
      assert.equal(remaining.data.updated_at, record.updated_at, 'Archive changed: stopping cleanup.');
      if (remaining.data.payload.cleared === true) continue;
      // This installation may permit UPDATE but not DELETE. Discard only the
      // authorized obsolete pointage payload; never modify policies to delete.
      const cleared = await db.from('hr_dashboard_store').update({ payload: { cleared: true } })
        .eq('id', record.id).eq('updated_at', record.updated_at).select('id');
      if (cleared.error) throw cleared.error;
      assert.equal(cleared.data?.length, 1, 'Archive changed or update forbidden.');
      const check = await db.from('hr_dashboard_store').select('payload').eq('id', record.id).single();
      if (check.error) throw check.error;
      assert.deepEqual(check.data.payload, { cleared: true });
      emptied++;
    }
    console.log(JSON.stringify({ verified: true, deleted, emptied, keptPunches: candidate.rawRows.length, keptDays: dates(candidate) }));
  }
} finally { await server.close(); }
