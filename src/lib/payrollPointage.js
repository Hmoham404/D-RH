import { prepareDailyPointage, getCurrentFilePointage, normalizeSavedPointageSnapshot } from './dailyPointage.js';
import { getPayrollPeriod, payrollPeriodToDate, pointageInPeriod } from './pointagePeriod.js';
import { getLocalPointageDate } from './pointageDates.js';
import { POINTAGE_DATE_VERSION, POINTAGE_SOURCE_DATE_CONTRACT } from './pointageDateSource.js';

export const PAYROLL_RETENTION = 'current-payroll-only-v1';

export function emptyPayrollSnapshot(today = getLocalPointageDate(), rules = {}) {
  const stamp = new Date().toISOString();
  return { retentionPolicy: PAYROLL_RETENTION, payrollPeriodStart: getPayrollPeriod(today).start,
    importId: `payroll-${stamp.replace(/\D/g, '')}`, generatedAt: stamp, fileName: '',
    dateNormalizationVersion: POINTAGE_DATE_VERSION, sourceDateContract: POINTAGE_SOURCE_DATE_CONTRACT,
    sourceOnlyVersion: 1, calculationRules: { ...rules, dateOrder: 'mdy' },
    rawRows: [], dayRows: [], weeklySheets: [], sourceWeeklySheets: [], dailySummaries: [],
    employeeRows: [], manualCorrections: [], closedDates: [], summary: { trackedDays: 0 },
    importDiagnostics: { incomingDates: [], incomingUsable: 0, rejectedRows: 0, duplicateRows: 0 },
  };
}

// Daily exports supplement the month. Identical passages are idempotent; RH
// corrections take precedence over subsequent reimports of the source file.
export async function preparePayrollPointage(file, employees, previous, rules, today = getLocalPointageDate()) {
  const incoming = await prepareDailyPointage(file, employees, null, rules);
  const period = payrollPeriodToDate(getPayrollPeriod(today), today);
  const current = pointageInPeriod(getCurrentFilePointage(previous), period);
  const addition = pointageInPeriod(getCurrentFilePointage(incoming), period);
  if (!addition.rawRows.length) throw new Error('Aucun passage du fichier dans le mois de paie en cours, du 26 à aujourd’hui. Import annulé.');
  const corrections = current?.manualCorrections || [];
  const corrected = new Set(corrections.map((item) => `${item.employeeKey}|${item.isoDate}`));
  const rows = new Map();
  const key = (row) => `${row.employeeKey || row.sourceId}|${row.pointageAt}`;
  (current?.rawRows || []).forEach((row) => rows.set(key(row), row));
  let repeated = 0;
  addition.rawRows.forEach((row) => {
    if (corrected.has(`${row.employeeKey}|${row.isoDate}`)) return;
    if (rows.has(key(row))) { repeated++; return; }
    rows.set(key(row), row);
  });
  const columns = new Map();
  const people = new Map();
  for (const sheet of [...(current?.sourceWeeklySheets || []), ...addition.sourceWeeklySheets]) {
    sheet.dayColumns.forEach((day) => columns.set(day.isoDate, day));
    for (const row of sheet.rows) {
      const id = String(row.employeeKey || row.id);
      const old = people.get(id);
      const days = new Map([...(old?.days || []), ...row.days].map((day) => [day.isoDate, day]));
      people.set(id, { ...row, days: [...days.values()] });
    }
  }
  const sourceWeeklySheets = columns.size ? [{ sheetName: 'Mois de paie', dayColumns: [...columns.values()].sort((a, b) => a.isoDate.localeCompare(b.isoDate)), rows: [...people.values()] }] : [];
  const breakOverrides = Object.fromEntries(corrections.filter((item) => Number.isFinite(Number(item.after?.breakMinutes)))
    .map((item) => [`${item.employeeKey}|${item.isoDate}`, Number(item.after.breakMinutes)]));
  const seed = { ...incoming, rawRows: [...rows.values()], sourceWeeklySheets, manualCorrections: corrections,
    currentFilePointage: null, importDiagnostics: null, dateRebuildRequired: true,
    calculationRules: { ...rules, dateOrder: 'mdy', breakOverrides } };
  const rebuilt = await normalizeSavedPointageSnapshot(seed, employees, rules.breakMinutes);
  const incomingDates = [...new Set(addition.rawRows.map((row) => row.isoDate))].sort();
  const diagnostics = { ...incoming.importDiagnostics, incomingDates,
    incomingUsable: addition.rawRows.length, duplicateRows: incoming.importDiagnostics.duplicateRows + repeated,
    outsidePeriodRows: incoming.rawRows.length - addition.rawRows.length };
  // All derived aggregates were rebuilt together, from the same retained rows.
  const result = { ...rebuilt, retentionPolicy: PAYROLL_RETENTION, payrollPeriodStart: period.start,
    importDiagnostics: diagnostics, storageRevision: previous?.storageRevision,
    closedDates: [...new Set(rebuilt.rawRows.map((row) => row.isoDate))].filter((date) => date < today) };
  const { storageRevision, storageNeedsDateRepair, currentFilePointage, ...view } = result;
  result.currentFilePointage = view;
  return result;
}
