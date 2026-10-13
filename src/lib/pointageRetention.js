import { canonicalizePointageSnapshotDates } from './pointageSnapshotDates.js';

export function classifyPointageRetention(record, period) {
  if (record.id !== 'rh-pointage-analysis' && !/^rh-pointage-history-[a-zA-Z0-9_-]+$/.test(record.id || '')) {
    return { id: record.id, action: 'protected', reason: 'Not a pointage record.' };
  }
  if (!record.updated_at) return { id: record.id, action: 'review', reason: 'Missing revision.' };
  if (record.payload?.cleared === true) {
    return { id: record.id, action: record.id === 'rh-pointage-analysis' ? 'keep' : 'delete', reason: 'Empty pointage archive.' };
  }
  let payload;
  try { payload = canonicalizePointageSnapshotDates(record.payload); }
  catch { return { id: record.id, action: 'review', reason: 'Invalid source dates or storage format.' }; }
  if (payload?.dateRebuildRequired || payload?.currentFilePointage?.dateRebuildRequired) {
    return { id: record.id, action: 'review', reason: 'Legacy dates require repair before deciding retention.' };
  }
  const dates = [...new Set([payload, payload?.currentFilePointage].filter(Boolean).flatMap((part) => [
    ...(part.rawRows || []).map((row) => row.isoDate),
    ...(part.dayRows || []).map((row) => row.isoDate),
    ...(part.dailySummaries || []).map((row) => row.isoDate),
    ...(part.closedDates || []),
    ...(part.sourceWeeklySheets || []).flatMap((sheet) => (sheet.dayColumns || []).map((day) => day.isoDate)),
  ]))].sort();
  if (!dates.length || dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date || ''))) {
    return { id: record.id, action: 'review', reason: 'No reliable source-date coverage.' };
  }
  const inside = dates.filter((date) => date >= period.start && date <= period.end);
  return { id: record.id, action: inside.length === dates.length ? 'keep' : inside.length ? 'trim-required' : 'delete',
    start: dates[0], end: dates.at(-1), keptDays: inside.length, outsideDays: dates.length - inside.length };
}
