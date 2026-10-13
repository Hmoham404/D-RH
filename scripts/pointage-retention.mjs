import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { getPayrollPeriod } from '../src/lib/pointagePeriod.js';
import { classifyPointageRetention } from '../src/lib/pointageRetention.js';

// --scan --today YYYY-MM-DD: read-only inventory + complete local backup.
// --apply PLAN_FILE --today YYYY-MM-DD: delete only exact, unchanged IDs from
// that inventory. Never clears payloads or changes schema, RLS, or other tables.
const args = process.argv.slice(2);
const today = args[args.indexOf('--today') + 1];
assert.ok(args.includes('--today') && /^\d{4}-\d{2}-\d{2}$/.test(today), 'Supply --today YYYY-MM-DD.');
const period = getPayrollPeriod(today);
const env = loadEnv('development', process.cwd(), '');
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(30000) }) },
});
const backupRoot = resolve('.pointage-backups');
const digest = (text) => createHash('sha256').update(text).digest('hex');
const checkedPath = (path) => {
  const absolute = resolve(path);
  const child = relative(backupRoot, absolute);
  assert.ok(child && !child.startsWith('..') && !isAbsolute(child), 'Plan and backup must be in .pointage-backups.');
  return absolute;
};
if (args.includes('--scan')) {
  assert.ok(!args.includes('--apply'));
  const rows = [];
  for (let offset = 0; ; offset += 10) {
    const { data, error } = await db.from('hr_dashboard_store').select('id,payload,updated_at')
      .or('id.eq.rh-pointage-analysis,id.like.rh-pointage-history-%').order('id').range(offset, offset + 9);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 10) break;
  }
  const entries = rows.map((row) => classifyPointageRetention(row, period));
  await mkdir(backupRoot, { recursive: true });
  const stem = `pointage-retention-${Date.now()}`;
  const backupFile = resolve(backupRoot, `${stem}-backup.json`);
  const backup = JSON.stringify(rows);
  await writeFile(backupFile, backup);
  const planFile = resolve(backupRoot, `${stem}-plan.json`);
  await writeFile(planFile, JSON.stringify({ today, period, backupFile, sha256: digest(backup), entries }, null, 2));
  console.log(JSON.stringify({ planFile, counts: entries.reduce((out, row) => ({ ...out, [row.action]: (out[row.action] || 0) + 1 }), {}) }));
} else if (args.includes('--apply')) {
  const plan = JSON.parse(await readFile(checkedPath(args[args.indexOf('--apply') + 1]), 'utf8'));
  assert.equal(plan.period.start, period.start, 'Expired retention plan.');
  const backup = await readFile(checkedPath(plan.backupFile), 'utf8');
  assert.equal(digest(backup), plan.sha256, 'Backup integrity check failed.');
  const rows = JSON.parse(backup);
  // Recompute the scope from backed-up source dates, not editable plan actions.
  const entries = rows.map((row) => ({ row, scope: classifyPointageRetention(row, period) }));
  const targets = entries.filter(({ scope }) => scope.action === 'delete');
  let deleted = 0;
  for (const { row } of targets) {
    const { data, error } = await db.from('hr_dashboard_store').delete()
      .eq('id', row.id).eq('updated_at', row.updated_at).select('id');
    if (error) throw error;
    assert.equal(data?.length, 1, `Deletion not confirmed for ${row.id}: changed revision or missing DELETE permission. Stopping.`);
    const verification = await db.from('hr_dashboard_store').select('id').eq('id', row.id).maybeSingle();
    if (verification.error) throw verification.error;
    assert.equal(verification.data, null, 'Deleted record is still present.');
    deleted++;
    await writeFile(checkedPath(`${plan.backupFile}.progress.json`), JSON.stringify({ deleted, lastId: row.id }));
  }
  console.log(JSON.stringify({ deleted, mixedRecordsNotDeleted: entries.filter(({ scope }) => scope.action === 'trim-required').length,
    recordsRequiringReview: entries.filter(({ scope }) => scope.action === 'review').length }));
} else {
  throw new Error('Use --scan or --apply PLAN_FILE.');
}
