import { analyzePointageFile } from './pointageImport.js';

const code = (value) => /^\d+$/.test(String(value || '').trim()) ? String(Number(value)) : String(value || '').trim();
const employeeKey = (employee) => code(employee.zk || employee.id || employee.finalCode || employee.saber);
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const iso = (date) => date.toISOString().slice(0, 10);

export function buildDailyWeeks(analysis, employees, closedDates = []) {
  const observed = [...new Set(analysis.rawRows.map((row) => row.isoDate))].sort();
  const closed = new Set(closedDates);
  const starts = [...new Set(observed.map((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return iso(date);
  }))];
  const roster = new Map(employees.filter((e) => employeeKey(e)).map((e) => [employeeKey(e), {
    employeeKey: employeeKey(e), id: code(e.zk || e.id || e.finalCode), fullName: e.fullName,
    department: e.department, kind: e.kind, service: e.service, employee: e,
  }]));
  const days = new Map(analysis.dayRows.map((row) => [`${row.employeeKey}|${row.isoDate}`, row]));
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
        let status = 'EMPTY';
        let display = '-';
        if (day) {
          const review = day.state !== 'OK' || day.matchState !== 'matched';
          status = review ? 'AVR' : 'POINTAGE';
          display = day.state !== 'OK' ? `${day.entry.slice(11, 16)} !` : `${day.roundedClock}${review ? ' !' : ''}`;
          total += day.roundedMinutes;
        } else if (closed.has(column.isoDate) && String(employee?.status).toLowerCase() === 'stc') {
          status = 'STC'; display = 'STC';
        } else if (closed.has(column.isoDate) && String(employee?.status).toLowerCase() === 'actif') {
          const rawHire = String(employee?.hiredAt || '');
          const frenchHire = rawHire.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
          const hire = frenchHire ? `${frenchHire[3]}-${frenchHire[2]}-${frenchHire[1]}` : rawHire;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(hire) || hire <= column.isoDate) { status = 'ABS'; display = 'ABS'; }
        }
        return { ...column, status, display, raw: display, workedMinutes: day?.roundedMinutes || 0, detail: day?.punchesDisplay || '', entry: day?.entry || '', exit: day?.exit || '' };
      });
      return { ...row, employeeStatus: employee.status, hiredAt: employee.hiredAt, days: cells, totalHours: clock(total), control: cells.some((day) => day.status === 'AVR') ? 'À vérifier' : '' };
    }).sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    return { sheetName: `S_${start}`, weekId: `S${start.replaceAll('-', '')}`, title: `Semaine du ${start}`, dayColumns, rows };
  });
}

export function buildDailyTable(analysis, employees, requestedDates) {
  if (!analysis?.rawRows?.length) return { dayColumns: [], rows: [] };
  const allowed = new Set(requestedDates);
  const closedDates = analysis.calculationRules ? analysis.closedDates || [] : analysis.rawRows.map((row) => row.isoDate);
  const sheets = buildDailyWeeks(analysis, employees, closedDates);
  const dayColumns = sheets.flatMap((sheet) => sheet.dayColumns).filter((day) => allowed.has(day.isoDate));
  const rows = new Map();
  sheets.forEach((sheet) => sheet.rows.forEach((row) => {
    if (!rows.has(row.employeeKey)) rows.set(row.employeeKey, { ...row, days: [] });
    rows.get(row.employeeKey).days.push(...row.days.filter((day) => allowed.has(day.isoDate)));
  }));
  return { dayColumns, rows: [...rows.values()].map((row) => ({ ...row,
    totalHours: clock(row.days.reduce((sum, day) => sum + day.workedMinutes, 0)),
    control: row.days.some((day) => day.status === 'AVR') ? 'À vérifier' : '',
  })) };
}

export async function prepareDailyPointage(file, employees, previous, rules) {
  const fileAnalysis = await analyzePointageFile(file, employees, { ...rules, allSourceSheets: true, deduplicate: true });
  const analysis = await analyzePointageFile(file, employees, {
    ...rules, allSourceSheets: true, deduplicate: true, previousRows: previous?.rawRows || [],
  });
  const newDates = analysis.importDiagnostics.incomingDates;
  const closedDates = [...new Set([...(previous?.closedDates || []), ...(rules.closeDays ? newDates : [])])];
  const currentFilePointage = {
    fileName: file.name, rawRows: fileAnalysis.rawRows, dayRows: fileAnalysis.dayRows,
    closedDates: rules.closeDays ? newDates : [], calculationRules: rules,
    importDiagnostics: fileAnalysis.importDiagnostics,
  };
  return { ...analysis, currentFilePointage, closedDates, calculationRules: rules, weeklySheets: buildDailyWeeks(analysis, employees, closedDates) };
}

export function getCurrentFilePointage(snapshot) {
  if (snapshot?.currentFilePointage) return snapshot.currentFilePointage;
  const dates = snapshot?.importDiagnostics?.incomingDates;
  if (!dates) return null;
  const allowed = new Set(dates);
  return { ...snapshot, rawRows: (snapshot.rawRows || []).filter((row) => allowed.has(row.isoDate)),
    dayRows: (snapshot.dayRows || []).filter((row) => allowed.has(row.isoDate)) };
}

export function formatPointageDate(value) {
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
      if (!day) return;
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
      if (day.status === 'ABS') absences.push(person);
      if (String(row.employeeStatus || '').trim().toLowerCase() !== 'actif') return;
      const rawHire = String(row.hiredAt || '');
      const french = rawHire.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const hire = french ? `${french[3]}-${french[2]}-${french[1]}` : rawHire;
      if (/^\d{4}-\d{2}-\d{2}$/.test(hire) && hire > isoDate) return;
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
