import { analyzePointageFile } from './pointageImport.js';
import { canonicalizePointageSnapshotDates, preservePointageSourceMetadata, POINTAGE_DATE_VERSION } from './pointageSnapshotDates.js';
import { POINTAGE_SOURCE_DATE_CONTRACT } from './pointageDateSource.js';
import * as XLSX from 'xlsx';

const code = (value) => /^\d+$/.test(String(value || '').trim()) ? String(Number(value)) : String(value || '').trim();
const employeeKey = (employee) => code(employee.zk || employee.id || employee.finalCode || employee.saber);
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const iso = (date) => date.toISOString().slice(0, 10);

function getEmployeeHireIso(employee, referenceIsoDate = '') {
  const hireValue = [employee?.hiredAt, employee?.hired_at, employee?.Date_Embauche,
    employee?.dateEmbauche, employee?.date_embauche, employee?.hireDate]
    .find((value) => value !== undefined && value !== null && String(value).trim() !== '') ?? '';
  const excelDate = hireValue instanceof Date && !Number.isNaN(hireValue.getTime())
    ? { y: hireValue.getFullYear(), m: hireValue.getMonth() + 1, d: hireValue.getDate() }
    : typeof hireValue === 'number' ? XLSX.SSF.parse_date_code(hireValue) : null;
  const rawHire = (excelDate
    ? `${excelDate.y}-${String(excelDate.m).padStart(2, '0')}-${String(excelDate.d).padStart(2, '0')}`
    : String(hireValue)).trim();
  const isoHire = rawHire.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
  const frenchHire = rawHire.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+.*)?$/);
  const frenchShortYearHire = rawHire.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})(?:\s+.*)?$/);
  const frenchMonthDayHire = rawHire.match(/^(\d{1,2})[/-](\d{1,2})$/);
  const dayOnlyHire = rawHire.match(/^(\d{1,2})$/);
  if (!isoHire && !frenchHire && !frenchShortYearHire && !frenchMonthDayHire && !dayOnlyHire) return '';
  const reference = String(referenceIsoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if ((dayOnlyHire || frenchMonthDayHire) && !reference) return '';
  const [year, month, day] = dayOnlyHire
    ? [Number(reference[1]), Number(reference[2]), Number(dayOnlyHire[1])]
    : isoHire
      ? [Number(isoHire[1]), Number(isoHire[2]), Number(isoHire[3])]
      : frenchHire
        ? [Number(frenchHire[3]), Number(frenchHire[2]), Number(frenchHire[1])]
        : frenchShortYearHire
          ? [2000 + Number(frenchShortYearHire[3]), Number(frenchShortYearHire[2]), Number(frenchShortYearHire[1])]
          : [Number(reference[1]), Number(frenchMonthDayHire[2]), Number(frenchMonthDayHire[1])];
  if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isEmployeeStartedBy(employee, isoDate) {
  const hire = getEmployeeHireIso(employee, isoDate);
  return !hire || hire <= isoDate;
}

function isEmployeeAbsenceEligibleBy(employee, isoDate) {
  const hire = getEmployeeHireIso(employee, isoDate);
  return Boolean(hire) && hire <= isoDate;
}

function shouldAddEmployeeFromDirectory(employee, observedDates) {
  const key = employeeKey(employee);
  const hireDate = getEmployeeHireIso(employee, observedDates[0] || '');
  const status = String(employee?.status || '').trim().toLowerCase();
  const contract = String(employee?.contract || '').trim().toLowerCase();
  if (!key || !hireDate || status !== 'actif' || contract === 'prestation') return false;
  return observedDates.some((date) => hireDate <= date);
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
  const directoryById = new Map(employees.flatMap((employee) => [employee.id, employee.finalCode]
    .map(code).filter(Boolean).map((key) => [key, employee])));
  const roster = new Map();
  const addPerson = (source, preferId = false) => {
    const sourceId = code(source.sourceId || source.id);
    const employee = preferId
      ? directoryById.get(sourceId) || directory.get(source.employeeKey)
      : directory.get(source.employeeKey) || directoryById.get(sourceId);
    if (!employee) return;
    if (String(employee.status || source.employeeStatus || '').trim() && String(employee.status || source.employeeStatus).trim().toLowerCase() !== 'actif') return;
    const person = {
      employeeKey: employeeKey(employee), id: employee.id || employee.finalCode || employee.zk || employee.saber || source.sourceId || source.id || source.employeeKey,
      fullName: employee.fullName || `${employee.lastName || ''} ${employee.firstName || ''}`.trim() || source.matchedName || source.fullName || source.sourceName || '-',
      department: employee.department || source.department || '', kind: employee.kind || source.kind || '',
      service: employee.service || source.service || '', employee,
      employeeStatus: employee.status || source.employeeStatus || '',
    };
    roster.set(person.employeeKey, person);
  };
  const sourceCells = new Map();
  sourceSheets.forEach((sheet) => sheet.rows.forEach((row) => {
    const employee = directoryById.get(code(row.id)) || directory.get(row.employeeKey);
    addPerson(row, true);
    if (!employee) return;
    row.days.forEach((day) => {
      if (day.isoDate && !['EMPTY', 'X'].includes(day.status) && day.display !== '-') {
        sourceCells.set(`${employeeKey(employee)}|${day.isoDate}`, day);
      }
    });
  }));
  (analysis.dayRows || []).forEach(addPerson);
  employees
    .filter((employee) => shouldAddEmployeeFromDirectory(employee, observed))
    .forEach((employee) => addPerson({
      employeeKey: employeeKey(employee),
      id: employee.id || employee.finalCode || employee.zk || employee.saber,
      fullName: employee.fullName || `${employee.lastName || ''} ${employee.firstName || ''}`.trim(),
      department: employee.department || '',
      service: employee.service || '',
      kind: employee.kind || '',
      employeeStatus: employee.status || '',
    }));
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
        const started = isEmployeeStartedBy(employee, column.isoDate);
        const absenceEligible = isEmployeeAbsenceEligibleBy(employee, column.isoDate);
        const sourceStatus = String(sourceCell?.status || '').toUpperCase();
        const sourceIsAbsenceLike = sourceCell && !['POINTAGE', 'AVR'].includes(sourceStatus);
        let status = 'EMPTY';
        let display = '-';
        if (!started && (day || sourceCell)) {
          status = 'X';
          display = '-';
        } else if (sourceIsAbsenceLike && !absenceEligible) {
          status = 'X';
          display = '-';
        } else if (day) {
          const review = day.state !== 'OK' || day.matchState !== 'matched';
          status = review ? 'AVR' : 'POINTAGE';
          display = day.state !== 'OK' ? day.entry.slice(11, 16) : `${day.roundedClock}${review ? ' !' : ''}`;
          total += day.roundedMinutes;
        } else if (sourceCell) {
          status = sourceCell.status; display = sourceCell.display;
        } else {
          const hireDate = getEmployeeHireIso(employee, column.isoDate);
          // Before the hire date, the cell stays empty; from the hire date, a blank closed day is ABS.
          if (hireDate && hireDate <= column.isoDate) {
            status = 'ABS'; display = 'ABS';
          }
        }
        const sourceTime = !day && ['POINTAGE', 'AVR'].includes(status) && String(display).match(/^(\d+):(\d{2})$/);
        const workedMinutes = day?.roundedMinutes || (sourceTime ? Number(sourceTime[1]) * 60 + Number(sourceTime[2]) : 0);
        if (!day) total += workedMinutes;
        return { ...column, status, display, raw: display, workedMinutes, breakMinutes: day?.breakMinutes, detail: day?.punchesDisplay || '', entry: exitOnly ? '' : day?.entry || '', exit: exitOnly ? day.entry : day?.exit || '' };
      });
      return { ...row, hiredAt: employee.hiredAt || employee.hired_at || employee.Date_Embauche || employee.dateEmbauche || employee.date_embauche || employee.hireDate || '', days: cells, totalHours: clock(total), control: cells.some((day) => day.status === 'AVR') ? 'À vérifier' : '' };
    }).filter((row) => row.days.some((day) => day.status !== 'EMPTY'))
      .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    return { sheetName: `S_${start}`, weekId: `S${start.replaceAll('-', '')}`, title: `Semaine du ${start}`, dayColumns, rows };
  });
}

export function buildDailyTable(analysis, employees, requestedDates) {
  if (!analysis) return { dayColumns: [], rows: [] };
  const allowed = new Set(requestedDates);
  const sheets = buildDailyWeeks(analysis, employees);
  const columnMap = new Map();
  sheets.forEach((sheet) => sheet.dayColumns.forEach((day) => {
    if (allowed.has(day.isoDate)) columnMap.set(day.isoDate, day);
  }));
  const dayColumns = [...columnMap.values()].sort((left, right) => left.isoDate.localeCompare(right.isoDate));
  const rows = new Map();
  sheets.forEach((sheet) => sheet.rows.forEach((row) => {
    if (!rows.has(row.employeeKey)) rows.set(row.employeeKey, { ...row, dayByDate: new Map() });
    const combined = rows.get(row.employeeKey);
    row.days.forEach((day) => {
      if (allowed.has(day.isoDate) && (!combined.dayByDate.has(day.isoDate) || combined.dayByDate.get(day.isoDate).status === 'EMPTY')) combined.dayByDate.set(day.isoDate, day);
    });
  }));
  rows.forEach((row) => {
    row.days = dayColumns.map((column) => {
      const existing = row.dayByDate.get(column.isoDate);
      const hireDate = getEmployeeHireIso(row, column.isoDate);
      if (hireDate && hireDate > column.isoDate) return { ...column, status: 'EMPTY', display: '-', raw: '-', workedMinutes: 0, detail: '', entry: '', exit: '' };
      if (existing?.status === 'ABS' && !hireDate) return { ...column, status: 'EMPTY', display: '-', raw: '-', workedMinutes: 0, detail: '', entry: '', exit: '' };
      if (existing && existing.status !== 'EMPTY') return existing;
      if (hireDate && hireDate <= column.isoDate) return { ...column, status: 'ABS', display: 'ABS', raw: 'ABS', workedMinutes: 0, detail: '', entry: '', exit: '' };
      return { ...column, status: 'EMPTY', display: '-', raw: '-', workedMinutes: 0, detail: '', entry: '', exit: '' };
    });
    delete row.dayByDate;
  });
  return { dayColumns, rows: [...rows.values()].filter((row) => row.days.some((day) => day.status !== 'EMPTY')).map((row) => ({ ...row,
    totalHours: clock(row.days.reduce((sum, day) => sum + (day.workedMinutes || 0), 0)),
    control: row.days.some((day) => day.status === 'AVR') ? 'À vérifier' : '',
  })) };
}

function keepWeeklySheetDates(sheet, excludedDates) {
  const dayColumns = (sheet.dayColumns || []).filter((day) => !excludedDates.has(day.isoDate));
  const allowedDates = new Set(dayColumns.map((day) => day.isoDate));
  return {
    ...sheet,
    dayColumns,
    rows: (sheet.rows || []).map((row) => ({
      ...row,
      days: (row.days || []).filter((day) => allowedDates.has(day.isoDate)),
    })).filter((row) => row.days.length),
  };
}

function getPayrollPeriodKey(isoDate) {
  const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const start = new Date(Date.UTC(year, month, 26));
  if (day < 26) start.setUTCMonth(start.getUTCMonth() - 1);
  return start.toISOString().slice(0, 10);
}

function mergeDailyPointage(previous, incoming, employees) {
  const oldPointage = getCurrentFilePointage(previous);
  if (!oldPointage) return incoming;

  const incomingDates = new Set(incoming.importDiagnostics?.incomingDates || []);
  const replacedDates = new Set(incomingDates);
  const previousDates = [
    ...(oldPointage.rawRows || []).map((row) => row.isoDate),
    ...(oldPointage.sourceWeeklySheets || []).flatMap((sheet) => sheet.dayColumns.map((day) => day.isoDate)),
  ].filter(Boolean).sort();
  const incomingDateList = [...incomingDates].sort();
  const previousPeriod = getPayrollPeriodKey(previousDates.at(-1));
  const incomingPeriod = getPayrollPeriodKey(incomingDateList.at(-1));
  // A new 26-to-25 payroll cycle starts a fresh current snapshot. The prior
  // cycle remains in Supabase history because daily saves no longer clear it.
  if (previousPeriod && incomingPeriod && previousPeriod !== incomingPeriod) return incoming;

  const oldRows = (oldPointage.rawRows || []).filter((row) => !replacedDates.has(row.isoDate));
  const oldDayRows = (oldPointage.dayRows || []).filter((row) => !replacedDates.has(row.isoDate));
  const sourceWeeklySheets = [
    ...(oldPointage.sourceWeeklySheets || []).map((sheet) => keepWeeklySheetDates(sheet, replacedDates)),
    ...(incoming.sourceWeeklySheets || []),
  ].filter((sheet) => sheet.dayColumns.length);
  const dailySummaries = new Map();
  [...(previous.dailySummaries || []).filter((day) => !replacedDates.has(day.isoDate)), ...(incoming.dailySummaries || [])]
    .forEach((day) => dailySummaries.set(day.isoDate, day));
  const dayRows = [...oldDayRows, ...(incoming.dayRows || [])];
  const rawRows = [...oldRows, ...(incoming.rawRows || [])];
  const manualCorrections = [
    ...(oldPointage.manualCorrections || []),
    ...(incoming.manualCorrections || []),
  ];
  const merged = {
    ...incoming,
    fileName: incoming.fileName,
    rawRows,
    dayRows,
    sourceWeeklySheets,
    closedDates: [...new Set([
      ...(oldPointage.closedDates || []).filter((date) => !replacedDates.has(date)),
      ...(incoming.closedDates || []),
    ])].sort(),
    dailySummaries: [...dailySummaries.values()].sort((a, b) => a.isoDate.localeCompare(b.isoDate)),
    manualCorrections,
  };
  merged.weeklySheets = buildDailyWeeks(merged, employees);
  const trackedDates = [...new Set([
    ...rawRows.map((row) => row.isoDate),
    ...sourceWeeklySheets.flatMap((sheet) => sheet.dayColumns.map((day) => day.isoDate)),
  ].filter(Boolean))].sort();
  merged.periodStart = trackedDates[0] || '';
  merged.periodEnd = trackedDates.at(-1) || '';
  merged.payrollPeriodStart = incomingPeriod || previousPeriod;
  merged.summary = { ...incoming.summary, trackedDays: trackedDates.length };
  merged.currentFilePointage = { ...merged, currentFilePointage: undefined };
  return merged;
}

export async function prepareDailyPointage(file, employees, previous, rules) {
  const savedCorrections = [
    ...(previous?.manualCorrections || []),
    ...(previous?.currentFilePointage?.manualCorrections || []),
  ];
  const savedBreakOverrides = Object.fromEntries(savedCorrections
    .filter((item) => item?.after && Number.isFinite(Number(item.after.breakMinutes)))
    .map((item) => [`${item.employeeKey}|${item.isoDate}`, Number(item.after.breakMinutes)]));
  const importRules = { ...rules, dateOrder: 'mdy',
    breakOverrides: { ...savedBreakOverrides, ...(rules?.breakOverrides || {}) } };
  const analysis = await analyzePointageFile(file, employees, {
    ...importRules, allSourceSheets: true, deduplicate: true,
  });
  const closedDates = importRules.closeDays ? analysis.importDiagnostics.incomingDates : [];
  const currentFilePointage = {
    sourceOnlyVersion: 1,
    dateNormalizationVersion: POINTAGE_DATE_VERSION,
    sourceDateContract: POINTAGE_SOURCE_DATE_CONTRACT,
    fileName: file.name, rawRows: analysis.rawRows, dayRows: analysis.dayRows,
    sourceWeeklySheets: analysis.weeklySheets,
    closedDates, calculationRules: importRules,
    importDiagnostics: analysis.importDiagnostics,
  };
  const incoming = { ...analysis, ...currentFilePointage, currentFilePointage,
    payrollPeriodStart: getPayrollPeriodKey(analysis.importDiagnostics.incomingDates.at(-1)),
    weeklySheets: buildDailyWeeks(currentFilePointage, employees) };
  return mergeDailyPointage(previous, incoming, employees);
}

export function getCurrentFilePointage(snapshot) {
  if (!snapshot) return null;
  const canonical = canonicalizePointageSnapshotDates(snapshot);
  if (canonical.currentFilePointage) return canonical.currentFilePointage;
  const dates = canonical.importDiagnostics?.incomingDates;
  const sourceWeeklySheets = canonical.sourceWeeklySheets?.length ? canonical.sourceWeeklySheets
    : (!canonical.calculationRules ? canonical.weeklySheets : []) || [];
  if (!dates) return { ...canonical, sourceWeeklySheets };
  const allowed = new Set(dates);
  return { ...canonical, sourceWeeklySheets,
    rawRows: (canonical.rawRows || []).filter((row) => allowed.has(row.isoDate)),
    dayRows: (canonical.dayRows || []).filter((row) => allowed.has(row.isoDate)),
  };
}

export async function normalizeSavedPointageSnapshot(snapshot, employees, requestedBreakMinutes) {
  if (!snapshot) return snapshot;
  const canonical = canonicalizePointageSnapshotDates(snapshot);
  const current = getCurrentFilePointage(canonical);
  const breakMinutes = Number.isFinite(Number(requestedBreakMinutes))
    ? Number(requestedBreakMinutes) : Number(current?.calculationRules?.breakMinutes ?? 24);
  const needsRebuild = canonical.dateRebuildRequired || current?.dateRebuildRequired
    || canonical.storageNeedsDateRepair || canonical.sourceOnlyVersion !== 1;
  if (!needsRebuild && Number(current?.calculationRules?.breakMinutes) === breakMinutes) {
    return { ...canonical, weeklySheets: buildDailyWeeks(canonical, employees) };
  }
  if (!current?.rawRows?.length) return canonical;

  // Recalculate from canonical timestamps, preserving original workbook cells.
  const workbook = XLSX.utils.book_new();
  const sheets = new Map();
  current.rawRows.forEach((row) => {
    const name = row.sheetName || 'SOURCE_POINTAGE';
    if (!sheets.has(name)) sheets.set(name, [['ID Emp.', 'Nom', 'Temps du Ptg', 'Terminal', 'Type de pointage']]);
    sheets.get(name).push([row.sourceId, row.sourceName, row.pointageAt, row.terminal, row.pointageType]);
  });
  sheets.forEach((rows, name) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name));
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const calculated = await prepareDailyPointage({ name: current.fileName || canonical.fileName, arrayBuffer: async () => buffer }, employees, null,
    { roundingMinutes: 1, closeDays: true, ...current.calculationRules, breakMinutes, dateOrder: 'mdy' });
  const result = preservePointageSourceMetadata(calculated, current.rawRows);
  const sourceWeeklySheets = current.sourceWeeklySheets || [];
  const manualCorrections = current.manualCorrections || canonical.manualCorrections || [];
  const rebuilt = { ...result, sourceWeeklySheets, manualCorrections, dateRebuildRequired: false,
    importId: canonical.importId, generatedAt: canonical.generatedAt,
    storageRevision: canonical.storageRevision, storageNeedsDateRepair: canonical.storageNeedsDateRepair,
    currentFilePointage: { ...result.currentFilePointage, sourceWeeklySheets, manualCorrections, dateRebuildRequired: false } };
  rebuilt.weeklySheets = buildDailyWeeks(rebuilt, employees);
  return canonicalizePointageSnapshotDates(rebuilt);
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
