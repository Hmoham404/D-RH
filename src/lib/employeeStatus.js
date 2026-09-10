const MONTH_NAMES = [
  ['jan', 'janv', 'janvier'],
  ['fev', 'fevr', 'fevrier'],
  ['mars'],
  ['avr', 'avril'],
  ['mai'],
  ['juin'],
  ['juil', 'juillet'],
  ['aout'],
  ['sep', 'sept', 'septembre'],
  ['oct', 'octobre'],
  ['nov', 'novembre'],
  ['dec', 'decembre'],
];

function parseExitMonth(value) {
  const text = String(value ?? '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let match = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3] || 1) };

  match = text.match(/^(?:(\d{1,2})[/-])?(\d{1,2})[/-](\d{4})$/);
  if (match) return { year: Number(match[3]), month: Number(match[2]), day: Number(match[1] || 1) };

  match = text.match(/^([a-z]+)\.?(?:[\s/-]+(\d{4}))?$/);
  if (match) {
    return {
      month: MONTH_NAMES.findIndex((names) => names.includes(match[1])) + 1,
      year: match[2] ? Number(match[2]) : null,
      day: 1,
    };
  }
  if (/^\d{1,2}$/.test(text)) return { month: Number(text), year: null, day: 1 };
  return null;
}

// Month-only Excel values belong to the current personnel snapshot.
// Older STC records remain inactive, but are not exits of the current month.
export function isEmployeeStcInMonth(employee, referenceDate = new Date()) {
  if (String(employee.status ?? '').trim().toLowerCase() !== 'stc') return false;
  const exit = parseExitMonth(employee.inactiveFrom ?? employee.inactive_from);
  if (!exit || Number.isNaN(referenceDate.getTime())) return false;
  const year = exit.year ?? referenceDate.getFullYear();
  if (exit.month < 1 || exit.month > 12 || exit.day < 1
    || exit.day > new Date(year, exit.month, 0).getDate()) return false;
  return exit.month === referenceDate.getMonth() + 1 && year === referenceDate.getFullYear();
}

export function isEmployeeHiredInMonth(employee, referenceDate = new Date()) {
  const text = String(employee.hiredAt ?? employee.hired_at ?? '').trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const french = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if ((!iso && !french) || Number.isNaN(referenceDate.getTime())) return false;
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(french[3]), Number(french[2]), Number(french[1])];
  if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return false;
  return year === referenceDate.getFullYear() && month === referenceDate.getMonth() + 1;
}
