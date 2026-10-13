import { getCurrentFilePointage, mergeDailyPointage } from './dailyPointage.js';
import { canonicalizePointageSnapshotDates } from './pointageSnapshotDates.js';
import { getPayrollPeriod, pointageInPeriod } from './pointagePeriod.js';

export function recoverMissingPayrollDays(current, archive, employees, referenceDate) {
  const period = getPayrollPeriod(referenceDate);
  const latest = canonicalizePointageSnapshotDates(current);
  const older = canonicalizePointageSnapshotDates(archive);
  const datesOf = (data) => [...new Set([
    ...(data?.rawRows || []).map((row) => row.isoDate),
    ...(data?.sourceWeeklySheets || []).flatMap((sheet) => sheet.dayColumns.map((day) => day.isoDate)),
  ])];
  const currentDates = new Set(datesOf(getCurrentFilePointage(latest)));
  if ([...currentDates].some((date) => date < period.start || date > period.end)) {
    throw new Error('Le pointage courant appartient a une autre periode.');
  }
  const archivedView = pointageInPeriod(getCurrentFilePointage(older), period);
  const restoredDates = datesOf(archivedView).filter((date) => !currentDates.has(date)).sort();
  if (!restoredDates.length) return { snapshot: latest, restoredDates };
  const missing = new Set(restoredDates);
  const sourceWeeklySheets = archivedView.sourceWeeklySheets.map((sheet) => ({ ...sheet,
    dayColumns: sheet.dayColumns.filter((day) => missing.has(day.isoDate)),
    rows: sheet.rows.map((row) => ({ ...row, days: row.days.filter((day) => missing.has(day.isoDate)) })),
  })).filter((sheet) => sheet.dayColumns.length);
  const view = { ...archivedView,
    rawRows: archivedView.rawRows.filter((row) => missing.has(row.isoDate)),
    dayRows: archivedView.dayRows.filter((row) => missing.has(row.isoDate)),
    manualCorrections: archivedView.manualCorrections.filter((row) => missing.has(row.isoDate)),
    closedDates: archivedView.closedDates.filter((date) => missing.has(date)), sourceWeeklySheets,
  };
  const old = { ...older, ...view, currentFilePointage: view,
    dailySummaries: (older.dailySummaries || []).filter((day) => missing.has(day.isoDate)) };
  const snapshot = mergeDailyPointage(old, latest, employees);
  // An import may already retain correction metadata for archived days.
  const corrections = new Map((snapshot.manualCorrections || []).map((item) => [`${item.employeeKey}|${item.isoDate}`, item]));
  snapshot.manualCorrections = [...corrections.values()];
  snapshot.currentFilePointage = { ...snapshot, currentFilePointage: undefined };
  return { snapshot, restoredDates };
}
