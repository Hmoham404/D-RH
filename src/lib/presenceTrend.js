import { getLocalPointageDate } from './pointageDates.js';
import { getPayrollPeriod } from './pointagePeriod.js';
import { isEmployeeActiveOnDate } from './employeeStatus.js';

// Keep the full selected 26-to-25 cycle on the axis, but only expose measures
// from before the selected date. Missing and later days remain gaps.
export function getDailyModChartPeriod(analysisDate = getLocalPointageDate()) {
  const yesterday = new Date(`${analysisDate}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const cutoff = yesterday.toISOString().slice(0, 10);
  return { ...getPayrollPeriod(analysisDate), cutoff };
}

export function buildDailyModPresenceDataset(history, analysisDate = getLocalPointageDate()) {
  const period = getDailyModChartPeriod(analysisDate);
  const points = buildPayrollPresenceDataset(history, period)
    .map((point) => ({ ...point, value: point.imported ? point.present : null }));
  return { start: period.start, end: period.end, cutoff: period.cutoff, points };
}

export function buildDailyModWorkforceDataset(employees, analysisDate = getLocalPointageDate()) {
  const period = getDailyModChartPeriod(analysisDate);
  const modEmployees = (employees || []).filter((employee) => /^production/i.test(employee.department || '')
    && String(employee.kind || '').toUpperCase() === 'MOD');
  const points = period.dates.map((isoDate) => ({ isoDate,
    value: isoDate <= period.cutoff
      ? modEmployees.filter((employee) => isEmployeeActiveOnDate(employee, new Date(`${isoDate}T12:00:00`))).length
      : null,
  }));
  return { start: period.start, end: period.end, cutoff: period.cutoff, points };
}

export function buildPayrollPresenceDataset(history, payrollPeriod) {
  const days = new Map((history || []).map((day) => [day.isoDate, day]));
  return payrollPeriod.dates.map((isoDate) => {
    const day = !payrollPeriod.cutoff || isoDate <= payrollPeriod.cutoff ? days.get(isoDate) : undefined;
    const mod = (day?.departments || [])
      .filter((group) => /^production/i.test(group.label || ''))
      .flatMap((group) => group.kinds || [])
      .filter((kind) => String(kind.label || '').toUpperCase() === 'MOD')
      .reduce((total, kind) => ({ expected: total.expected + Number(kind.expected || 0),
        present: total.present + Number(kind.present || 0) }), { expected: 0, present: 0 });
    return { isoDate, imported: Boolean(day), ...mod,
      value: mod.expected ? mod.present / mod.expected * 100 : null };
  });
}

export const MOD_ABSENCE_TARGET = 5;
export const MOD_ABSENCE_TARGET_MARGIN = 0.5;
export const MOD_ABSENCE_TARGET_MAX = MOD_ABSENCE_TARGET + MOD_ABSENCE_TARGET_MARGIN;

export function getAbsenceTargetBand(value, target = MOD_ABSENCE_TARGET, upperTarget = target + MOD_ABSENCE_TARGET_MARGIN) {
  if (!Number.isFinite(value)) return 'empty';
  if (value > upperTarget + 1e-9) return 'above';
  if (value < target - 1e-9) return 'below';
  return 'target';
}

export function buildPayrollAbsenceDataset(history, payrollPeriod) {
  const days = new Map((history || []).map((day) => [day.isoDate, day]));
  return payrollPeriod.dates.filter((isoDate) => {
    const weekday = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
    return weekday !== 0 && weekday !== 6;
  }).map((isoDate) => {
    const day = !payrollPeriod.cutoff || isoDate <= payrollPeriod.cutoff ? days.get(isoDate) : undefined;
    const mod = (day?.departments || [])
      .filter((group) => /^production/i.test(group.label || ''))
      .flatMap((group) => group.kinds || [])
      .filter((kind) => String(kind.label || '').toUpperCase() === 'MOD')
      .reduce((total, kind) => ({ expected: total.expected + Number(kind.expected || 0),
        present: total.present + Number(kind.present || 0) }), { expected: 0, present: 0 });
    const absent = Math.max(0, mod.expected - mod.present);
    return { isoDate, imported: Boolean(day), ...mod, absent,
      value: mod.expected ? absent / mod.expected * 100 : null };
  });
}
