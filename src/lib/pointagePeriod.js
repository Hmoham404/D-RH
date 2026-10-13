import { getLocalPointageDate } from './pointageDates.js';

export function getPayrollPeriod(referenceDate = getLocalPointageDate()) {
  const match = String(referenceDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('Date de reference de paie invalide.');
  const [, year, month, day] = match.map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day));
  if (anchor.getUTCFullYear() !== year || anchor.getUTCMonth() !== month - 1 || anchor.getUTCDate() !== day) {
    throw new Error('Date de reference de paie invalide.');
  }
  const start = new Date(Date.UTC(year, month - 1 - (day < 26 ? 1 : 0), 26));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 25));
  const dates = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return { start: dates[0], end: dates.at(-1), dates };
}

export function pointageInPeriod(data, period) {
  if (!data) return null;
  const contains = (date) => date >= period.start && date <= period.end;
  return {
    ...data,
    rawRows: (data.rawRows || []).filter((row) => contains(row.isoDate)),
    dayRows: (data.dayRows || []).filter((row) => contains(row.isoDate)),
    closedDates: (data.closedDates || []).filter(contains),
    manualCorrections: (data.manualCorrections || []).filter((row) => contains(row.isoDate)),
    sourceWeeklySheets: (data.sourceWeeklySheets || []).map((sheet) => ({
      ...sheet,
      dayColumns: (sheet.dayColumns || []).filter((day) => contains(day.isoDate)),
      rows: (sheet.rows || []).map((row) => ({ ...row, days: (row.days || []).filter((day) => contains(day.isoDate)) })),
    })).filter((sheet) => sheet.dayColumns.length),
  };
}

export function payrollPeriodToDate(period, today = getLocalPointageDate()) {
  const dates = period.dates.filter((date) => date <= today);
  return { ...period, end: dates.at(-1) || period.start, dates };
}

export function splitPayrollWeeks(dayColumns) {
  const weeks = new Map();
  for (const day of dayColumns) {
    const monday = new Date(`${day.isoDate}T12:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const start = monday.toISOString().slice(0, 10);
    if (!weeks.has(start)) {
      const sunday = new Date(monday);
      sunday.setUTCDate(sunday.getUTCDate() + 6);
      weeks.set(start, { start, end: sunday.toISOString().slice(0, 10), dayColumns: [] });
    }
    weeks.get(start).dayColumns.push(day);
  }
  return [...weeks.values()];
}

// Add calendar columns only after attendance has been calculated from imported
// days. Unimported dates must never generate absences or worked hours.
export function fillPayrollCalendar(table, period) {
  const imported = new Map(table.dayColumns.map((day) => [day.isoDate, day]));
  const dayColumns = period.dates.map((isoDate) => ({ ...imported.get(isoDate), isoDate, imported: imported.has(isoDate) }));
  return {
    ...table, dayColumns,
    rows: table.rows.map((row) => {
      const cells = new Map(row.days.map((day) => [day.isoDate, day]));
      return { ...row, days: dayColumns.map((day) => cells.get(day.isoDate) || {
        ...day, status: 'EMPTY', display: '-', raw: '-', workedMinutes: 0, detail: '', entry: '', exit: '',
      }) };
    }),
  };
}
