import { analyzePointageFile } from './pointageImport.js';
import { getExcelDateCorrections } from './pointageDates.js';
import * as XLSX from 'xlsx';

const code = (value) => /^\d+$/.test(String(value || '').trim()) ? String(Number(value)) : String(value || '').trim();
const employeeKey = (employee) => code(employee.zk || employee.id || employee.finalCode || employee.saber);
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const iso = (date) => date.toISOString().slice(0, 10);
const localIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function getEmployeeHireIso(employee, referenceIsoDate = '') {
  const rawHire = String(
    employee?.hiredAt ??
    employee?.hired_at ??
    employee?.Date_Embauche ??
    employee?.dateEmbauche ??
    employee?.date_embauche ??
    employee?.hireDate ??
    '',
  ).trim();
  const isoHire = rawHire.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const frenchHire = rawHire.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const dayOnlyHire = rawHire.match(/^(\d{1,2})$/);
  if (!isoHire && !frenchHire && !dayOnlyHire) return '';
  const reference = String(referenceIsoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dayOnlyHire && !reference) return '';
  const [year, month, day] = dayOnlyHire
    ? [Number(reference[1]), Number(reference[2]), Number(dayOnlyHire[1])]
    : isoHire
      ? [Number(isoHire[1]), Number(isoHire[2]), Number(isoHire[3])]
      : [Number(frenchHire[3]), Number(frenchHire[2]), Number(frenchHire[1])];
  if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isEmployeeStartedBy(employee, isoDate) {
  const hire = getEmployeeHireIso(employee, isoDate);
  return !hire || hire <= isoDate;
}

function parseMdyDateTime(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const month = Number(match[1]) - 1;
  const day = Number(match[2]);
  const year = Number(match[3]);
  const hours = Number(match[4] || 0);
  const minutes = Number(match[5] || 0);
  const seconds = Number(match[6] || 0);
  const parsed = new Date(year, month, day, hours, minutes, seconds);
  return parsed.getFullYear() === year && parsed.getMonth() === month && parsed.getDate() === day
    ? parsed
    : null;
}

function parseDmyDateTime(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  const hours = Number(match[4] || 0);
  const minutes = Number(match[5] || 0);
  const seconds = Number(match[6] || 0);
  const parsed = new Date(year, month, day, hours, minutes, seconds);
  return parsed.getFullYear() === year && parsed.getMonth() === month && parsed.getDate() === day
    ? parsed
    : null;
}

function formatFrDateTime(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

function replaceLegacyDateTimes(value) {
  return String(value || '').replace(/\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?/g, (dateTime) => {
    const parsed = parseMdyDateTime(dateTime);
    return parsed ? formatFrDateTime(parsed) : dateTime;
  });
}

function getRowDateText(row) {
  return row?.pointageAtDisplay || row?.entry || row?.exit || row?.punchesDisplay || '';
}

function shouldNormalizeLegacyDmySnapshotDates(pointage) {
  if (pointage?.calculationRules?.dateOrder === 'dmy') return true;
  const rows = [...(pointage?.rawRows || []), ...(pointage?.dayRows || [])];
  return rows.some((row) => {
    const text = getRowDateText(row);
    const dmy = parseDmyDateTime(text);
    const mdy = parseMdyDateTime(text);
    if (!dmy || !mdy) return false;
    if (pointage?.calculationRules?.dateOrder === 'mdy' && row?.isoDate === localIso(dmy)) return false;
    return row?.isoDate !== localIso(mdy);
  });
}

function normalizeLegacyDmySnapshotDates(pointage) {
  if (pointage?.dateNormalizationVersion >= 3) return pointage;
  const excelCorrections = getExcelDateCorrections(pointage?.fileName, (pointage?.rawRows || []).map((row) => row.isoDate));
  if (pointage?.dateNormalizationVersion === 2 && !excelCorrections.size) return pointage;
  if (!excelCorrections.size && !shouldNormalizeLegacyDmySnapshotDates(pointage)) return pointage;

  const normalizeRow = (row) => {
    if (excelCorrections.size && !excelCorrections.has(row.isoDate)) return row;
    const parsed = parseMdyDateTime(getRowDateText(row));
    if (!parsed) return row;
    return {
      ...row,
      isoDate: localIso(parsed),
      pointageAt: `${localIso(parsed)}T${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}:${String(parsed.getSeconds()).padStart(2, '0')}`,
      pointageAtDisplay: row.pointageAtDisplay ? formatFrDateTime(parsed) : row.pointageAtDisplay,
      entry: row.entry ? replaceLegacyDateTimes(row.entry) : row.entry,
      exit: row.exit ? replaceLegacyDateTimes(row.exit) : row.exit,
      punchesDisplay: row.punchesDisplay ? replaceLegacyDateTimes(row.punchesDisplay) : row.punchesDisplay,
    };
  };

  const rawRows = (pointage.rawRows || []).map(normalizeRow);
  const dayRows = (pointage.dayRows || []).map(normalizeRow);
  const dateMap = new Map(
    [...(pointage.rawRows || []), ...(pointage.dayRows || [])]
      .map((row) => [row.isoDate, normalizeRow(row).isoDate]),
  );
  const remapDates = (values = []) => [...new Set(values.map((value) => dateMap.get(value) || value).filter(Boolean))].sort();
  const observedDates = [...new Set([...rawRows, ...dayRows].map((row) => row.isoDate).filter(Boolean))].sort();
  const closedDates = pointage.closedDates?.length ? remapDates(pointage.closedDates) : observedDates;

  return {
    ...pointage,
    dateNormalizationVersion: 3,
    rawRows,
    dayRows,
    closedDates: pointage.closedDates?.length ? closedDates : pointage.closedDates,
    importDiagnostics: pointage.importDiagnostics
      ? { ...pointage.importDiagnostics, incomingDates: remapDates(pointage.importDiagnostics.incomingDates || closedDates) }
      : pointage.importDiagnostics,
    calculationRules: { ...pointage.calculationRules, dateOrder: 'mdy' },
  };
}

export function buildDailyWeeks(analysis, employees) {
  // Only source cells and punches establish membership in a day's roster.
  const sourceSheets = analysis.sourceWeeklySheets || [];
  const observed = [...new Set([
    ...(analysis.rawRows || []).map((row) => row.isoDate),
    ...sourceSheets.flatMap((sheet) => sheet.dayColumns.map((day) => day.isoDate)),
  ].filter(Boolean))].sort();
  const starts = [...new Set(observed.map((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return iso(date);
  }))];
  const directory = new Map(employees.map((employee) => [employeeKey(employee), employee]));
  const roster = new Map();
  const addPerson = (source) => {
    const employee = directory.get(source.employeeKey) || {};
    const person = {
      employeeKey: source.employeeKey, id: source.sourceId || source.id || source.employeeKey,
      fullName: source.matchedName || source.fullName || source.sourceName || employee.fullName || '-',
      department: employee.department || source.department || '', kind: employee.kind || source.kind || '',
      service: employee.service || source.service || '', employee,
      employeeStatus: employee.status || source.employeeStatus || '',
    };
    roster.set(person.employeeKey, person);
  };
  const sourceCells = new Map();
  sourceSheets.forEach((sheet) => sheet.rows.forEach((row) => {
    addPerson(row);
    row.days.forEach((day) => {
      if (day.isoDate && !['EMPTY', 'X'].includes(day.status) && day.display !== '-') {
        sourceCells.set(`${row.employeeKey}|${day.isoDate}`, day);
      }
    });
  }));
  (analysis.dayRows || []).forEach(addPerson);
  const days = new Map((analysis.dayRows || []).map((row) => [`${row.employeeKey}|${row.isoDate}`, row]));
  const corrections = new Map((analysis.manualCorrections || []).map((item) => [`${item.employeeKey}|${item.isoDate}`, item.after]));
  return starts.map((start) => {
    const end = new Date(`${start}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const dayColumns = observed.filter((value) => value >= start && value <= iso(end)).map((value) => {
      const date = new Date(`${value}T12:00:00Z`);
      return { isoDate: iso(date), label: date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }) };
    });
    const rows = [...roster.values()].map(({ employee, ...row }) => {
      let total = 0;
      const cells = dayColumns.map((column) => {
        const day = days.get(`${row.employeeKey}|${column.isoDate}`);
        const sourceCell = sourceCells.get(`${row.employeeKey}|${column.isoDate}`);
        const correction = corrections.get(`${row.employeeKey}|${column.isoDate}`);
        const exitOnly = day && !day.exit && correction?.exit && correction.entry === '';
        let status = 'EMPTY';
        let display = '-';
        if (day) {
          const review = day.state !== 'OK' || day.matchState !== 'matched';
          status = review ? 'AVR' : 'POINTAGE';
          display = day.state !== 'OK' ? day.entry.slice(11, 16) : `${day.roundedClock}${review ? ' !' : ''}`;
          total += day.roundedMinutes;
        } else if (sourceCell && isEmployeeStartedBy(employee, column.isoDate)) {
          status = sourceCell.status; display = sourceCell.display;
        } else {
          const hireDate = getEmployeeHireIso(employee, column.isoDate);
          // A blank cell becomes ABS only once a recorded hire date has begun.
          if (hireDate && hireDate <= column.isoDate) {
            status = 'ABS'; display = 'ABS';
          }
        }
        const sourceTime = !day && ['POINTAGE', 'AVR'].includes(status) && String(display).match(/^(\d+):(\d{2})$/);
        const workedMinutes = day?.roundedMinutes || (sourceTime ? Number(sourceTime[1]) * 60 + Number(sourceTime[2]) : 0);
        if (!day) total += workedMinutes;
        return { ...column, status, display, raw: display, workedMinutes, detail: day?.punchesDisplay || '', entry: exitOnly ? '' : day?.entry || '', exit: exitOnly ? day.entry : day?.exit || '' };
      });
      return { ...row, hiredAt: employee.hiredAt || employee.hired_at || '', days: cells, totalHours: clock(total), control: cells.some((day) => day.status === 'AVR') ? 'À vérifier' : '' };
    }).filter((row) => row.days.some((day) => day.status !== 'EMPTY'))
      .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    return { sheetName: `S_${start}`, weekId: `S${start.replaceAll('-', '')}`, title: `Semaine du ${start}`, dayColumns, rows };
  });
}

export function buildDailyTable(analysis, employees, requestedDates) {
  if (!analysis) return { dayColumns: [], rows: [] };
  const allowed = new Set(requestedDates);
  const sheets = buildDailyWeeks(analysis, employees);
  const dayColumns = sheets.flatMap((sheet) => sheet.dayColumns).filter((day) => allowed.has(day.isoDate));
  const rows = new Map();
  sheets.forEach((sheet) => sheet.rows.forEach((row) => {
    if (!rows.has(row.employeeKey)) rows.set(row.employeeKey, { ...row, days: [] });
    rows.get(row.employeeKey).days.push(...row.days.filter((day) => allowed.has(day.isoDate)));
  }));
  return { dayColumns, rows: [...rows.values()].filter((row) => row.days.some((day) => day.status !== 'EMPTY')).map((row) => ({ ...row,
    totalHours: clock(row.days.reduce((sum, day) => sum + day.workedMinutes, 0)),
    control: row.days.some((day) => day.status === 'AVR') ? 'À vérifier' : '',
  })) };
}

export async function prepareDailyPointage(file, employees, _previous, rules) {
  const analysis = await analyzePointageFile(file, employees, {
    ...rules, allSourceSheets: true, deduplicate: true,
  });
  const closedDates = rules.closeDays ? analysis.importDiagnostics.incomingDates : [];
  const currentFilePointage = {
    sourceOnlyVersion: 1,
    dateNormalizationVersion: 3,
    fileName: file.name, rawRows: analysis.rawRows, dayRows: analysis.dayRows,
    sourceWeeklySheets: analysis.weeklySheets,
    closedDates, calculationRules: rules,
    importDiagnostics: analysis.importDiagnostics,
  };
  return { ...analysis, ...currentFilePointage, currentFilePointage,
    weeklySheets: buildDailyWeeks(currentFilePointage, employees) };
}

export function getCurrentFilePointage(snapshot) {
  if (snapshot?.currentFilePointage) return normalizeLegacyDmySnapshotDates(snapshot.currentFilePointage);
  const dates = snapshot?.importDiagnostics?.incomingDates;
  if (!snapshot) return null;
  if (!dates) return normalizeLegacyDmySnapshotDates({ ...snapshot,
    sourceWeeklySheets: snapshot.sourceWeeklySheets?.length ? snapshot.sourceWeeklySheets : (!snapshot.calculationRules ? snapshot.weeklySheets : []) || [] });
  const allowed = new Set(dates);
  return normalizeLegacyDmySnapshotDates({ ...snapshot,
    sourceWeeklySheets: snapshot.sourceWeeklySheets?.length ? snapshot.sourceWeeklySheets : (!snapshot.calculationRules ? snapshot.weeklySheets : []) || [],
    rawRows: (snapshot.rawRows || []).filter((row) => allowed.has(row.isoDate)),
    dayRows: (snapshot.dayRows || []).filter((row) => allowed.has(row.isoDate)) });
}

export async function normalizeSavedPointageSnapshot(snapshot, employees) {
  if (!snapshot) return snapshot;
  const current = getCurrentFilePointage(snapshot);
  const original = snapshot.currentFilePointage;
  const datesChanged = original && current?.rawRows?.some((row, index) => row.isoDate !== original.rawRows[index]?.isoDate);
  if (snapshot.sourceOnlyVersion === 1 && !datesChanged) {
    return { ...snapshot, weeklySheets: buildDailyWeeks(snapshot, employees) };
  }
  if (!current?.rawRows?.length) return null;

  // Rebuild summaries and weeks from corrected punches so every view uses the same dates.
  const workbook = XLSX.utils.book_new();
  const sheets = new Map();
  current.rawRows.forEach((row) => {
    const name = row.sheetName || 'SOURCE_POINTAGE';
    if (!sheets.has(name)) sheets.set(name, [['ID Emp.', 'Nom', 'Temps du Ptg', 'Terminal', 'Type de pointage']]);
    sheets.get(name).push([row.sourceId, row.sourceName, row.pointageAt, row.terminal, row.pointageType]);
  });
  sheets.forEach((rows, name) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name));
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const result = await prepareDailyPointage({ name: current.fileName || snapshot.fileName, arrayBuffer: async () => buffer }, employees, snapshot,
    { breakMinutes: 0, roundingMinutes: 1, closeDays: true, ...current.calculationRules, dateOrder: 'mdy' });
  const sourceWeeklySheets = current.sourceWeeklySheets || [];
  const rebuilt = { ...result, sourceWeeklySheets, manualCorrections: current.manualCorrections || [],
    currentFilePointage: { ...result.currentFilePointage, sourceWeeklySheets, manualCorrections: current.manualCorrections || [] } };
  return { ...rebuilt, importId: snapshot.importId, generatedAt: snapshot.generatedAt,
    weeklySheets: buildDailyWeeks(rebuilt, employees),
    periodStart: result.dailySummaries[0]?.isoDate || '', periodEnd: result.dailySummaries.at(-1)?.isoDate || '',
    importDiagnostics: { ...snapshot.importDiagnostics, incomingDates: result.importDiagnostics.incomingDates },
    currentFilePointage: { ...rebuilt.currentFilePointage,
      importDiagnostics: { ...current.importDiagnostics, incomingDates: result.currentFilePointage.importDiagnostics.incomingDates } } };
}

export function formatPointageDate(value, locale = 'fr-FR') {
  if (locale !== 'fr-FR') {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  }
  const months = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  const [year, month, day] = String(value || '').split('-');
  return year && months[Number(month) - 1] && day ? `${day} ${months[Number(month) - 1]} ${year}` : '-';
}

export function buildAttendanceByDay(table) {
  return table.dayColumns.map(({ isoDate }) => {
    const departments = new Map();
    const absences = [];
    const late = [];
    table.rows.forEach((row) => {
      const day = row.days.find((item) => item.isoDate === isoDate);
      if (!day || ['EMPTY', 'X', 'STC'].includes(day.status)) return;
      if (day.status === 'PRESTATION') return;
      const service = String(row.service || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
      const department = String(row.department || '').trim();
      const production = /PRODUCTION/i.test(department);
      const productionService = /INJ/.test(service) ? 'Injection'
        : /MET/.test(service) ? 'Métallisation'
          : /SERIG|^SER\b/.test(service) ? 'Sérigraphie'
            : /ASSEM|^ASS\b/.test(service) ? 'Assemblage' : '';
      const label = /GARDIEN|GARDIANG/.test(service) ? 'Gardiennage'
        : /NETTOY|NETOY/.test(service) ? 'Nettoyage'
          : /PROJET|PROJECT/.test(service) ? 'Projet'
            : production ? `Production · ${productionService || row.service || 'Service non renseigné'}` : department || 'Non renseigné';
      const person = { id: row.id, fullName: row.fullName, department: label, employeeKey: row.employeeKey, kind: row.kind || '-' };
      if (!isEmployeeStartedBy(row, isoDate)) return;
      if (day.status === 'ABS') absences.push(person);
      const entryTime = (day.entry || '').match(/\s(\d{2}):(\d{2})(?::(\d{2}))?$/);
      const entrySeconds = entryTime ? Number(entryTime[1]) * 3600 + Number(entryTime[2]) * 60 + Number(entryTime[3] || 0) : 0;
      const isLate = ['POINTAGE', 'AVR'].includes(day.status) && entrySeconds > 7.5 * 3600;
      if (isLate) late.push({ ...person, entry: day.entry.slice(11), delay: Math.ceil((entrySeconds - 7.5 * 3600) / 60) });
      if (!departments.has(label)) departments.set(label, { label, expected: 0, present: 0, absent: 0, review: 0, unknown: 0, late: 0, kinds: {}, people: [] });
      const group = departments.get(label);
      group.people.push({ ...person, status: day.status, entry: day.entry?.slice(11) || '-', delay: isLate ? Math.ceil((entrySeconds - 7.5 * 3600) / 60) : 0 });
      const kind = String(row.kind || '').trim().toUpperCase() || 'Non renseigné';
      group.kinds[kind] ||= { label: kind, expected: 0, present: 0, absent: 0, late: 0 };
      const category = group.kinds[kind];
      category.expected += 1;
      if (['POINTAGE', 'AVR'].includes(day.status)) category.present += 1;
      if (day.status === 'ABS') category.absent += 1;
      if (isLate) { category.late += 1; group.late += 1; }
      group.expected += 1;
      if (['POINTAGE', 'AVR'].includes(day.status)) group.present += 1;
      if (day.status === 'AVR') group.review += 1;
      if (day.status === 'ABS') group.absent += 1;
      if (day.status === 'EMPTY') group.unknown += 1;
    });
    return { isoDate, absences, late: late.sort((a, b) => b.delay - a.delay), departments: [...departments.values()].map((group) => ({ ...group,
      kinds: Object.values(group.kinds).map((kind) => ({ ...kind, percent: kind.present / kind.expected * 100 })),
      percent: group.expected ? group.present / group.expected * 100 : 0,
    })).sort((a, b) => a.label.localeCompare(b.label, 'fr')) };
  });
}
