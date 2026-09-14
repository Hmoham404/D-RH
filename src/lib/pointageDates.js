// Daily exports named DDMM.xlsx provide an anchor when Excel has swapped dates.
export function getExcelDateCorrections(fileName, dates) {
  const name = String(fileName || '').match(/^(\d{2})(\d{2})\.xlsx?$/i);
  const unique = [...new Set(dates)].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  if (!name || !unique.length) return new Map();
  const [, day, month] = name;
  if (Number(day) > 31 || Number(day) < 1 || Number(month) > 12 || Number(month) < 1) return new Map();
  if (!unique.some((date) => [ `${month}-${day}`, `${day}-${month}` ].includes(date.slice(5)))) return new Map();

  const corrections = new Map();
  for (const date of unique) {
    const [year, oldMonth, oldDay] = date.split('-');
    const anchor = new Date(`${year}-${month}-${day}T12:00:00Z`);
    const originalDaysBeforeExport = (anchor - new Date(`${date}T12:00:00Z`)) / 86400000;
    if (originalDaysBeforeExport >= 0 && originalDaysBeforeExport <= 31) continue;
    const corrected = `${year}-${oldDay}-${oldMonth}`;
    const parsed = new Date(`${corrected}T12:00:00Z`);
    const daysBeforeExport = (anchor - parsed) / 86400000;
    if (!Number.isFinite(daysBeforeExport) || parsed.toISOString().slice(0, 10) !== corrected
      || daysBeforeExport < 0 || daysBeforeExport > 31) continue;
    corrections.set(date, corrected);
  }
  return corrections;
}

export function getLocalPointageDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function getDefaultPointageDate(dates, today = getLocalPointageDate()) {
  const sorted = [...new Set(dates)].filter(Boolean).sort();
  return sorted.includes(today) ? today : sorted.at(-1) || '';
}
