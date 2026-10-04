import { normalizeEmployeeRhDate } from './employeeBaseImport.js';

const pad = (value) => String(value).padStart(2, '0');
const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function getDatedDeparture(employee) {
  const raw = [employee?.inactiveFrom, employee?.inactive_from]
    .find((value) => value !== null && value !== undefined && String(value).trim() && !/^0+(?:\.0+)?$/.test(String(value).trim()));
  const normalized = normalizeEmployeeRhDate(raw);
  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  return new Date(year, month - 1, day);
}

export function getEmployeeStcPeriod(referenceDate = new Date()) {
  if (!(referenceDate instanceof Date) || Number.isNaN(referenceDate.getTime())) return null;
  const startDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 26);
  if (referenceDate.getDate() < 26) startDate.setMonth(startDate.getMonth() - 1);
  const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 25);
  return { startDate, endDate, periodStart: isoDate(startDate), periodEnd: isoDate(endDate) };
}

// Count only dated departures in the selected 26-to-25 payroll period that
// have already taken effect on the selected calendar day.
export function isEmployeeStcInPeriod(employee, referenceDate = new Date()) {
  const period = getEmployeeStcPeriod(referenceDate);
  const departure = getDatedDeparture(employee);
  if (!period || !departure) return false;
  const selectedDay = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  return departure >= period.startDate && departure <= period.endDate && departure <= selectedDay;
}

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
  let match = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?(?:[t\s].*)?$/);
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3] || 1) };

  match = text.match(/^(?:(\d{1,2})[/-])?(\d{1,2})[/-](\d{4})(?:[t\s].*)?$/);
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

// Dated STC records appear only from their effective date through the rest of
// that month. A future date in the same month must not appear early.
export function isEmployeeStcInMonth(employee, referenceDate = new Date()) {
  const rawExit = employee.inactiveFrom ?? employee.inactive_from;
  const exit = parseExitMonth(rawExit);
  if (!exit || Number.isNaN(referenceDate.getTime())) return false;
  // A dated departure is authoritative even when the source spreadsheet still
  // says "Actif". Month-only legacy values continue to require an STC status.
  const hasDepartureDate = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})(?:[t\s].*)?$/i.test(String(rawExit ?? '').trim());
  if (String(employee.status ?? '').trim().toLowerCase() !== 'stc' && !hasDepartureDate) return false;
  const year = exit.year ?? referenceDate.getFullYear();
  if (exit.month < 1 || exit.month > 12 || exit.day < 1
    || exit.day > new Date(year, exit.month, 0).getDate()) return false;
  if (exit.month !== referenceDate.getMonth() + 1 || year !== referenceDate.getFullYear()) return false;
  if (hasDepartureDate) {
    const stcFrom = new Date(year, exit.month - 1, exit.day);
    const asOfDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
    return stcFrom <= asOfDate;
  }
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

export function isEmployeeActiveInMonth(employee, referenceDate = new Date()) {
  if (String(employee.status ?? '').trim().toLowerCase() !== 'actif' || Number.isNaN(referenceDate.getTime())) return false;
  const rawExit = String(employee.inactiveFrom ?? employee.inactive_from ?? '').trim();
  const datedExit = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})(?:[t\s].*)?$/i.test(rawExit)
    ? parseExitMonth(rawExit)
    : null;
  if (datedExit) {
    const exitYear = datedExit.year;
    if (datedExit.month < 1 || datedExit.month > 12 || datedExit.day < 1
      || datedExit.day > new Date(exitYear, datedExit.month, 0).getDate()) return false;
    const exitDate = new Date(exitYear, datedExit.month - 1, datedExit.day);
    const asOfDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
    if (exitDate <= asOfDate) return false;
  }
  const text = String(employee.hiredAt ?? employee.hired_at ?? '').trim();
  if (!text || text === '0') return true;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const french = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!iso && !french) return false;
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(french[3]), Number(french[2]), Number(french[1])];
  if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return false;
  return new Date(year, month - 1, day) <= new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
}
