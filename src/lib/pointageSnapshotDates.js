import { parsePointageSourceDate, getPointageSourceEncoding, POINTAGE_DATE_VERSION, POINTAGE_SOURCE_DATE_CONTRACT } from './pointageDateSource.js';

export { POINTAGE_DATE_VERSION } from './pointageDateSource.js';
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const pad = (value) => String(value).padStart(2, '0');
const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const isoTime = (date) => `${isoDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
const frenchDate = (value) => { const [year, month, day] = value.split('-'); return `${day}/${month}/${year}`; };
const dateFields = new Set(['isoDate', 'periodStart', 'periodEnd', 'firstSeenDate', 'lastSeenDate']);
const timestampFields = new Set(['pointageAt', 'firstSeenAt', 'lastSeenAt']);
const dateArrayFields = new Set(['incomingDates', 'closedDates']);
const displayFields = new Set(['pointageAtDisplay', 'entry', 'exit', 'punchesDisplay', 'detail']);
const sourceFields = ['sourceDateValue', 'sourceDateText', 'sourceDateFormat', 'sourceDateEncoding', 'sourceDateIso'];

function sourceEncoding(row, part) {
  // Versions before 9 treated Excel's regional built-in formats as an explicit
  // American calendar format. Recover their actual source policy once.
  if (Number(part.dateNormalizationVersion || 0) < POINTAGE_DATE_VERSION
    && row.sourceDateEncoding === 'excel-serial') {
    return getPointageSourceEncoding(row.sourceDateValue, { format: row.sourceDateFormat || '' });
  }
  return row.sourceDateEncoding || (own(row, 'sourceDateValue')
    ? getPointageSourceEncoding(row.sourceDateValue, { format: row.sourceDateFormat || '' }) : 'canonical-iso');
}

function sourceDate(row, part) {
  if (own(row, 'sourceDateValue')) {
    return parsePointageSourceDate(row.sourceDateValue, {
      text: row.sourceDateText || '', format: row.sourceDateFormat || '',
      encoding: sourceEncoding(row, part), canonicalIso: row.sourceDateIso || '',
    });
  }
  // Only an explicitly recorded legacy DMY import permits interpreting its
  // former date label as the user's MDY source. Modern French labels are UI text.
  if (Number(part.dateNormalizationVersion || 0) < POINTAGE_DATE_VERSION
    && part.calculationRules?.dateOrder === 'dmy') {
    const label = row.pointageAtDisplay || row.entry || row.exit || row.punchesDisplay;
    const parsed = parsePointageSourceDate(String(label || '').split(' | ')[0]);
    if (parsed) return parsed;
  }
  return parsePointageSourceDate(row.pointageAt || row.sourceDateIso || `${row.isoDate || ''}T00:00:00`);
}

function canonicalizePart(part, fallbackRules) {
  if (!part || typeof part !== 'object' || part.cleared) return part;
  const effective = { ...part, calculationRules: part.calculationRules || fallbackRules };
  const dateMap = new Map();
  let changed = false;
  let ambiguousMapping = false;
  const rawRows = (part.rawRows || []).map((row) => {
    const parsed = sourceDate(row, effective);
    if (!parsed) return row;
    const correctedIso = isoDate(parsed);
    const correctedAt = isoTime(parsed);
    if (row.isoDate && dateMap.has(row.isoDate) && dateMap.get(row.isoDate) !== correctedIso) ambiguousMapping = true;
    if (row.isoDate) dateMap.set(row.isoDate, correctedIso);
    if (row.isoDate !== correctedIso || row.pointageAt !== correctedAt) changed = true;
    return { ...row, isoDate: correctedIso, pointageAt: correctedAt,
      pointageAtDisplay: `${frenchDate(correctedIso)} ${correctedAt.slice(11)}`,
      sourceDateIso: correctedAt,
      sourceDateEncoding: sourceEncoding(row, effective),
    };
  });
  const remapDate = (date) => ambiguousMapping ? date : dateMap.get(date) || date;
  const remapTimestamp = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
    ? `${remapDate(value.slice(0, 10))}${value.slice(10)}` : value;
  function remap(value, key = '', parentDate = '') {
    if (Array.isArray(value)) {
      if (dateArrayFields.has(key)) return [...new Set(value.map(remapDate))].sort();
      if (key === 'punches') return value.map((item) => typeof item === 'string' ? remapTimestamp(item) : item);
      return value.map((item) => remap(item, '', parentDate));
    }
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const anchor = value.isoDate || parentDate;
      return Object.fromEntries(Object.entries(value).map(([field, item]) => [field,
        field === 'rawRows' || field === 'currentFilePointage' || sourceFields.includes(field)
          ? item : remap(item, field, anchor)]));
    }
    if (typeof value !== 'string') return value;
    if (dateFields.has(key)) return remapDate(value);
    if (timestampFields.has(key)) return remapTimestamp(value);
    const targetDate = remapDate(parentDate);
    if (displayFields.has(key) && parentDate && targetDate !== parentDate) {
      return value.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (token, day, month, year) =>
        `${year}-${pad(month)}-${pad(day)}` === parentDate ? frenchDate(targetDate) : token);
    }
    return value;
  }
  const normalized = { ...remap(part), rawRows,
    sourceWeeklySheets: remap(own(part, 'sourceWeeklySheets') ? part.sourceWeeklySheets
      : !part.calculationRules ? part.weeklySheets || [] : []),
    dateNormalizationVersion: POINTAGE_DATE_VERSION,
    sourceDateContract: POINTAGE_SOURCE_DATE_CONTRACT,
    calculationRules: { ...(effective.calculationRules || {}), dateOrder: 'mdy' },
    dateRebuildRequired: Boolean(part.dateRebuildRequired || changed || ambiguousMapping),
  };
  const dates = [...new Set([
    ...rawRows.map((row) => row.isoDate),
    ...(normalized.sourceWeeklySheets || []).flatMap((sheet) => (sheet.dayColumns || []).map((day) => day.isoDate)),
  ].filter(Boolean))].sort();
  if (dates.length) {
    normalized.periodStart = dates[0];
    normalized.periodEnd = dates.at(-1);
  }
  if (part.currentFilePointage) normalized.currentFilePointage = canonicalizePart(part.currentFilePointage, effective.calculationRules);
  return normalized;
}

// SQL stores ISO calendar dates. Date labels and filenames never override them.
// Original workbook values, when preserved, are the authority for a repair.
export function canonicalizePointageSnapshotDates(snapshot) {
  return canonicalizePart(snapshot, snapshot?.currentFilePointage?.calculationRules);
}

export function preservePointageSourceMetadata(result, sourceRows) {
  const key = (row) => `${String(row.sourceId || row.employeeKey || '').trim()}|${row.pointageAt || ''}`;
  const originals = new Map((sourceRows || []).map((row) => [key(row), row]));
  const restore = (rows = []) => rows.map((row) => {
    const original = originals.get(key(row));
    if (!original) return row;
    const fields = Object.fromEntries(sourceFields.filter((field) => own(original, field)).map((field) => [field, original[field]]));
    return { ...row, ...fields };
  });
  return { ...result, rawRows: restore(result.rawRows),
    currentFilePointage: result.currentFilePointage
      ? { ...result.currentFilePointage, rawRows: restore(result.currentFilePointage.rawRows) }
      : result.currentFilePointage,
  };
}
