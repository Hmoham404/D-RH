// The clock export displays month/day/year. Keep that source contract separate
// from the French labels rendered by the dashboard.
export const POINTAGE_DATE_VERSION = 9;
export const POINTAGE_SOURCE_DATE_CONTRACT = 'mdy-visible-v1';

function validDate(year, month, day, hours = 0, minutes = 0, seconds = 0) {
  if (month < 1 || month > 12 || day < 1 || hours < 0 || hours > 23
    || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
  const date = new Date(year, month - 1, day, hours, minutes, seconds);
  return date.getFullYear() === year && date.getMonth() === month - 1
    && date.getDate() === day ? date : null;
}

export function excelSerialToPointageDate(value) {
  if (!Number.isFinite(value)) return null;
  const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
  if (Number.isNaN(utc.getTime())) return null;
  return validDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(),
    utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds());
}

export function isDayFirstExcelFormat(format) {
  // Ignore locale/color directives, literals, escapes and time-only sections.
  const dateTokens = String(format || '').split(';')[0]
    .replace(/\[[^\]]*\]|"[^"]*"|\\.|_.|\*./g, '')
    .split(/[hHsS]/)[0].match(/[dmy]+/gi) || [];
  const month = dateTokens.findIndex((token) => /^m/i.test(token));
  const day = dateTokens.findIndex((token) => /^d{1,2}$/i.test(token));
  return day >= 0 && month >= 0 && day < month;
}

export function isLocalizedExcelDateFormat(format) {
  // Standard Excel formats 14 and 22 are localized by Excel's UI. SheetJS
  // exposes their US default even when the workbook was viewed as DD/MM in
  // French Excel. This clock export uses that French regional display, while
  // the user's source timestamp contract remains MM/DD/YYYY.
  return ['m/d/yy', 'mm-dd-yy', 'm/d/yy h:mm'].includes(String(format || '').trim().toLowerCase());
}

function parseText(value) {
  const text = String(value ?? '').trim();
  // Dates are calendar timestamps. No Date.parse or browser locale inference.
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/);
  const mdy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  const match = iso || mdy;
  if (!match) return null;
  const year = Number(iso ? match[1] : match[3]);
  return validDate(year < 100 ? 2000 + year : year,
    Number(iso ? match[2] : match[1]), Number(iso ? match[3] : match[2]),
    Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
}

export function getPointageSourceEncoding(value, { format = '', encoding = '' } = {}) {
  if (encoding) return encoding;
  if (value instanceof Date) return 'date-object';
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value ?? '').trim())) {
    if (isLocalizedExcelDateFormat(format)) return 'excel-localized-mdy';
    return isDayFirstExcelFormat(format) ? 'excel-visible-mdy' : 'excel-serial';
  }
  return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(String(value ?? '').trim()) ? 'iso-text' : 'mdy-text';
}

export function parsePointageSourceDate(value, { text = '', format = '', encoding = '', canonicalIso = '' } = {}) {
  const sourceEncoding = getPointageSourceEncoding(value, { format, encoding });
  if (sourceEncoding === 'canonical-iso') return parseText(canonicalIso || value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  const raw = String(value ?? '').trim();
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(raw)) {
    const serialDate = excelSerialToPointageDate(Number(value));
    if (serialDate && sourceEncoding === 'excel-localized-mdy') {
      // A day above 12 cannot become a month. Those native Excel dates are
      // unambiguous and retain their calendar date (e.g. September 30).
      if (serialDate.getDate() > 12) return serialDate;
      return validDate(serialDate.getFullYear(), serialDate.getDate(), serialDate.getMonth() + 1,
        serialDate.getHours(), serialDate.getMinutes(), serialDate.getSeconds());
    }
    if (!serialDate || sourceEncoding !== 'excel-visible-mdy') return serialDate;
    // Excel may have converted a visible MDY timestamp using the local DMY
    // setting. The visible date is authoritative for this export. Preserve the
    // serial's time, including seconds hidden by an hh:mm display format.
    const visible = String(text || '').trim();
    const datePart = visible.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?=\s|$)/);
    if (!datePart && visible) return null;
    const year = datePart ? Number(datePart[3]) : serialDate.getFullYear();
    const month = datePart ? Number(datePart[1]) : serialDate.getDate();
    const day = datePart ? Number(datePart[2]) : serialDate.getMonth() + 1;
    return validDate(year < 100 ? 2000 + year : year, month, day,
      serialDate.getHours(), serialDate.getMinutes(), serialDate.getSeconds());
  }
  return parseText(raw);
}
