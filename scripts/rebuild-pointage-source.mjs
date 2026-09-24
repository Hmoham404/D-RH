import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { buildAttendanceByDay, buildDailyTable, normalizeSavedPointageSnapshot } from '../src/lib/dailyPointage.js';

const env = loadEnv('development', process.cwd(), '');
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) },
});
const table = 'hr_dashboard_store';
const currentId = 'rh-pointage-analysis';
const historyPrefix = 'rh-pointage-history-';
async function checked(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
async function readPages(makeQuery) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await checked(makeQuery().range(offset, offset + 499));
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
const stored = await checked(db.from(table).select('id,payload,updated_at').eq('id', currentId).single());
const records = await readPages(() => db.from('hr_staff_directory').select('*').order('record_id'));
const directoryState = await checked(db.from(table).select('payload').eq('id', 'rh-staff-directory-active-records').maybeSingle());
const activeIds = directoryState?.payload?.recordIds;
const employees = records.filter((row) => !Array.isArray(activeIds) || activeIds.includes(row.record_id)).map((row) => ({
  ...row, recordId: row.record_id, fullName: row.full_name, hiredAt: row.hired_at,
  finalCode: row.final_code, payType: row.pay_type,
}));
const rebuilt = await normalizeSavedPointageSnapshot(stored.payload, employees);
assert.ok(rebuilt?.rawRows?.length, 'No usable current file: refusing to clear the saved pointage.');
assert.equal(rebuilt.sourceOnlyVersion, 1);
const dates = [...new Set(rebuilt.weeklySheets.flatMap((week) => week.dayColumns.map((day) => day.isoDate)))].sort();
const attendance = buildAttendanceByDay(buildDailyTable(rebuilt, employees, dates));
console.log(JSON.stringify({
  mode: process.argv.includes('--apply') ? 'apply' : 'preview', file: rebuilt.fileName,
  beforePunches: stored.payload.rawRows.length, afterPunches: rebuilt.rawRows.length,
  days: attendance.map((day) => ({ date: day.isoDate,
    workforce: day.departments.reduce((sum, group) => sum + group.expected, 0),
    present: day.departments.reduce((sum, group) => sum + group.present, 0),
    absent: day.absences.length,
    newArrivalsBefore24: day.isoDate < '2026-09-24'
      ? day.departments.flatMap((group) => group.people).filter((person) => Number(person.id) >= 342 && Number(person.id) <= 353).length : 0,
  })),
}, null, 2));

if (process.argv.includes('--apply')) {
  const history = await readPages(() => db.from(table).select('id,updated_at').like('id', `${historyPrefix}%`).order('id'));
  const backupDirectory = resolve('.pointage-backups', `pointage-${Date.now()}`);
  await mkdir(backupDirectory, { recursive: true });
  const backupPath = resolve(backupDirectory, 'current.json');
  await writeFile(backupPath, JSON.stringify({ current: stored, history }), { flag: 'wx' });
  console.log(JSON.stringify({ backupPath, historyEntries: history.length }));
  // A concurrent import must not be overwritten by this maintenance operation.
  const saved = await checked(db.from(table).update({ payload: rebuilt, updated_at: new Date().toISOString() })
    .eq('id', currentId).eq('updated_at', stored.updated_at).select('id'));
  assert.equal(saved.length, 1, 'Pointage changed during the rebuild. Retry from a fresh preview.');
  const verified = await checked(db.from(table).select('payload').eq('id', currentId).single());
  assert.deepEqual(verified.payload.rawRows, rebuilt.rawRows);
  assert.deepEqual(verified.payload.weeklySheets, rebuilt.weeklySheets);
  let removedHistory = 0;
  for (const [index, entry] of history.entries()) {
    const archived = await checked(db.from(table).select('id,payload,updated_at')
      .eq('id', entry.id).eq('updated_at', entry.updated_at).maybeSingle());
    if (!archived) continue;
    await writeFile(resolve(backupDirectory, `history-${index}.json`), JSON.stringify(archived), { flag: 'wx' });
    const deleted = await checked(db.from(table).delete().eq('id', entry.id).eq('updated_at', entry.updated_at).select('id'));
    if (!deleted.length) {
      const cleared = await checked(db.from(table).update({ payload: { cleared: true }, updated_at: new Date().toISOString() })
        .eq('id', entry.id).eq('updated_at', entry.updated_at).select('id'));
      assert.equal(cleared.length, 1, 'History could not be cleared.');
    }
    removedHistory += 1;
    if (removedHistory % 10 === 0) console.log(JSON.stringify({ removedHistory, totalHistory: history.length }));
  }
  const remaining = await readPages(() => db.from(table).select('id,cleared:payload->>cleared').like('id', `${historyPrefix}%`).order('id'));
  assert.ok(remaining.every((row) => String(row.cleared) === 'true'), 'Some history payloads remain.');
  console.log(JSON.stringify({ saved: true, clearedHistory: removedHistory, backupPath }));
}
