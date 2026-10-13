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
