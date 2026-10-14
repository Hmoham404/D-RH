export function buildPayrollPresenceDataset(history, payrollPeriod) {
  const days = new Map((history || []).map((day) => [day.isoDate, day]));
  return payrollPeriod.dates.map((isoDate) => {
    const day = days.get(isoDate);
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

export function getAbsenceTargetBand(value, target = MOD_ABSENCE_TARGET) {
  if (!Number.isFinite(value)) return 'empty';
  if (value > target + 1e-9) return 'above';
  if (value < target - 1e-9) return 'below';
  return 'target';
}

export function buildPayrollAbsenceDataset(history, payrollPeriod) {
  const days = new Map((history || []).map((day) => [day.isoDate, day]));
  return payrollPeriod.dates.filter((isoDate) => {
    const weekday = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
    return weekday !== 0 && weekday !== 6;
  }).map((isoDate) => {
    const day = days.get(isoDate);
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
