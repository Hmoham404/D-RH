import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { normalizeSavedPointageSnapshot } from '../src/lib/dailyPointage.js';
import { canonicalizePointageSnapshotDates, POINTAGE_DATE_VERSION } from '../src/lib/pointageSnapshotDates.js';
import { parsePointageSourceDate, getPointageSourceEncoding, POINTAGE_SOURCE_DATE_CONTRACT } from '../src/lib/pointageDateSource.js';

// One explicit, user-confirmed recovery of the saved 03.xlsx export.
// A legacy serial alone cannot tell us the original visible date order.
// Do not generalize this recovery to other files or historical dates.
const currentId = 'rh-pointage-analysis';
const oldDate = '2026-03-10';
const intendedDate = '2026-10-03';
const oldVisibleDate = '10/03/2026';
const clone = (value) => JSON.parse(JSON.stringify(value));
const backupArgument = process.argv.indexOf('--source-backup');
const sourceBackupPath = backupArgument >= 0 ? resolve(process.argv[backupArgument + 1] || '') : null;
const punchKey = (row) => JSON.stringify([String(row.sourceId || ''), row.sourceName || '',
  (row.pointageAt || '').slice(11), row.terminal || '', row.pointageType || '']);
let recoveredCells = new Map();
if (sourceBackupPath) {
  const savedSource = JSON.parse(await readFile(sourceBackupPath, 'utf8'));
  const original = savedSource.payload || savedSource.current?.payload;
  assert.equal(original?.fileName, '03.xlsx', 'Source backup belongs to another file.');
  assert.equal(original.rawRows?.length, 76, 'Source backup must contain the exact 76 punches.');
  assert.ok(original.rawRows.every((row) => typeof row.sourceDateValue === 'number'), 'Source backup has lost the original Excel values.');
  recoveredCells = new Map(original.rawRows.map((row) => [punchKey(row), row]));
  assert.equal(recoveredCells.size, 76, 'Ambiguous duplicate punches in source backup.');
}
const env = loadEnv('development', process.cwd(), '');
assert.ok(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY, 'Missing Supabase configuration.');
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) },
});
async function checked(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
async function pages(makeQuery) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await checked(makeQuery().range(offset, offset + 499));
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
function annotateOriginalVisibleCells(payload) {
  const annotated = clone(payload);
  for (const part of [annotated, annotated.currentFilePointage].filter(Boolean)) {
    assert.equal(part.fileName, '03.xlsx', 'Unexpected file: this recovery is deliberately restricted to 03.xlsx.');
    assert.equal(part.rawRows?.length, 76, 'Unexpected row count: refusing a broad date migration.');
    part.rawRows = part.rawRows.map((savedRow) => {
      let row = savedRow;
      if (typeof row.sourceDateValue !== 'number' && recoveredCells.size) {
        const original = recoveredCells.get(punchKey(row));
        assert.ok(original, 'Saved punch does not exactly match the source backup: refusing restoration.');
        row = { ...row, ...Object.fromEntries(Object.entries(original).filter(([key]) => key.startsWith('sourceDate'))) };
      }
      assert.equal(row.isoDate, oldDate, 'Unexpected legacy date.');
      assert.equal(typeof row.sourceDateValue, 'number', 'Original numeric Excel source is required.');
      assert.ok(row.pointageAtDisplay?.startsWith(`${oldVisibleDate} `), 'Original visible label does not match the confirmed source.');
      const serial = parsePointageSourceDate(row.sourceDateValue);
      assert.ok(serial && serial.getFullYear() === 2026 && serial.getMonth() === 2 && serial.getDate() === 10,
        'Original serial is not the known localized March 10 value.');
      if (getPointageSourceEncoding(row.sourceDateValue, { format: row.sourceDateFormat }) === 'excel-localized-mdy') {
        return { ...row, sourceDateEncoding: 'excel-localized-mdy' };
      }
      return { ...row, sourceDateText: row.pointageAtDisplay,
        sourceDateFormat: 'dd/mm/yyyy hh:mm:ss', sourceDateEncoding: 'excel-visible-mdy' };
    });
    part.dateRebuildRequired = true;
  }
  return annotated;
}
function validate(before, after) {
  assert.equal(after.dateNormalizationVersion, POINTAGE_DATE_VERSION);
  assert.equal(after.sourceDateContract, POINTAGE_SOURCE_DATE_CONTRACT);
  for (const [index, part] of [after, after.currentFilePointage].entries()) {
    const original = index ? before.currentFilePointage : before;
    assert.equal(part.rawRows.length, 76, 'Repair must retain every punch.');
    assert.deepEqual([...new Set(part.rawRows.map((row) => row.isoDate))], [intendedDate]);
    for (const [rowIndex, row] of part.rawRows.entries()) {
      assert.equal(row.sourceDateValue, original.rawRows[rowIndex].sourceDateValue, 'Original Excel serial changed.');
      assert.equal(row.pointageAt.slice(11), original.rawRows[rowIndex].pointageAt.slice(11), 'Punch time changed.');
      assert.equal(row.sourceDateIso, row.pointageAt);
      assert.ok(['excel-visible-mdy', 'excel-localized-mdy'].includes(row.sourceDateEncoding));
    }
    assert.deepEqual(part.importDiagnostics.incomingDates, [intendedDate]);
    assert.equal(part.calculationRules.dateOrder, 'mdy');
  }
  assert.deepEqual([...new Set(after.weeklySheets.flatMap((week) => week.dayColumns.map((day) => day.isoDate)))], [intendedDate]);
  assert.deepEqual(after.dailySummaries.map((day) => day.isoDate), [intendedDate]);
  assert.equal(after.periodStart, intendedDate);
  assert.equal(after.periodEnd, intendedDate);
  assert.deepEqual(canonicalizePointageSnapshotDates(clone(after)), clone(after), 'Repair must be idempotent.');
}

const stored = await checked(db.from('hr_dashboard_store').select('id,payload,updated_at').eq('id', currentId).single());
if (stored.payload.dateNormalizationVersion === POINTAGE_DATE_VERSION
  && stored.payload.sourceDateContract === POINTAGE_SOURCE_DATE_CONTRACT
  && stored.payload.rawRows?.every((row) => row.isoDate === intendedDate)) {
  console.log(JSON.stringify({ alreadyRepaired: true, file: stored.payload.fileName,
    punches: stored.payload.rawRows.length, dates: [intendedDate], updatedAt: stored.updated_at }));
  process.exit(0);
}
const annotated = annotateOriginalVisibleCells(stored.payload);
const records = await pages(() => db.from('hr_staff_directory').select('*').order('record_id'));
const directory = await checked(db.from('hr_dashboard_store').select('payload').eq('id', 'rh-staff-directory-active-records').maybeSingle());
const active = directory?.payload?.recordIds;
const employees = records.filter((row) => !Array.isArray(active) || active.includes(row.record_id)).map((row) => ({
  ...row, recordId: row.record_id, fullName: row.full_name, hiredAt: row.hired_at,
  finalCode: row.final_code, payType: row.pay_type,
}));
const repaired = clone(await normalizeSavedPointageSnapshot(annotated, employees));
delete repaired.storageRevision;
delete repaired.storageNeedsDateRepair;
validate(annotated, repaired);
const reload = clone(await normalizeSavedPointageSnapshot(clone(repaired), employees));
validate(annotated, reload);
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'preview',
  file: repaired.fileName, punches: repaired.rawRows.length, before: oldDate, after: intendedDate,
  sourceSerialsPreserved: true, punchTimesPreserved: true, reloadVerified: true }));

if (process.argv.includes('--apply')) {
  const history = await pages(() => db.from('hr_dashboard_store').select('id,payload,updated_at')
    .like('id', 'rh-pointage-history-%').eq('payload->>importId', stored.payload.importId).order('id'));
  const backupDirectory = resolve('.pointage-backups', `date-repair-${Date.now()}`);
  await mkdir(backupDirectory, { recursive: true });
  await writeFile(resolve(backupDirectory, 'before.json'), JSON.stringify({ current: stored, history, sourceBackupPath }), { flag: 'wx' });
  const saved = await checked(db.from('hr_dashboard_store').update({ payload: repaired, updated_at: new Date().toISOString() })
    .eq('id', currentId).eq('updated_at', stored.updated_at).select('id'));
  assert.equal(saved.length, 1, 'A concurrent import changed the current snapshot. No replacement was made.');
  const verified = await checked(db.from('hr_dashboard_store').select('id,payload,updated_at').eq('id', currentId).single());
  assert.deepEqual(verified.payload, repaired, 'Supabase readback differs from the repaired payload.');
  validate(annotated, verified.payload);
  let repairedHistory = 0;
  for (const entry of history) {
    // Restrict archive repairs to the same exact source import; preserve all other history.
    if (entry.payload.fileName !== '03.xlsx' || entry.payload.rawRows?.length !== 76
      || !entry.payload.rawRows.every((row) => row.isoDate === oldDate)) continue;
    const archivedSource = annotateOriginalVisibleCells(entry.payload);
    const archivedRepair = clone(await normalizeSavedPointageSnapshot(archivedSource, employees));
    delete archivedRepair.storageRevision;
    delete archivedRepair.storageNeedsDateRepair;
    validate(archivedSource, archivedRepair);
    const changed = await checked(db.from('hr_dashboard_store').update({ payload: archivedRepair, updated_at: new Date().toISOString() })
      .eq('id', entry.id).eq('updated_at', entry.updated_at).select('id'));
    assert.equal(changed.length, 1, 'Archive changed concurrently; it was not overwritten.');
    repairedHistory += 1;
  }
  await writeFile(resolve(backupDirectory, 'after.json'), JSON.stringify(verified), { flag: 'wx' });
  console.log(JSON.stringify({ saved: true, verifiedDates: [intendedDate], punches: verified.payload.rawRows.length,
    repairedHistory, updatedAt: verified.updated_at, backupDirectory }));
}
