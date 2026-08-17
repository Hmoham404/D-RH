import * as XLSX from 'xlsx';

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeCode(value) {
  const raw = cleanText(value);
  if (!raw) return '';

  if (/^\d+$/.test(raw)) {
    return String(Number(raw));
  }

  return raw.toUpperCase();
}

function normalizeName(value) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[.\-_\/]/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .sort()
    .join('|');
}

function normalizeLooseText(value) {
  return cleanText(value)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '');
}

function buildEmployeeKey(employee) {
  return (
    normalizeCode(employee.zk) ||
    normalizeCode(employee.id) ||
    normalizeCode(employee.finalCode) ||
    normalizeCode(employee.saber) ||
    normalizeName(employee.fullName)
  );
}

function buildEmployeeIndex(employees) {
  const byCode = new Map();
  const byName = new Map();

  employees.forEach((employee) => {
    const codes = [
      normalizeCode(employee.id),
      normalizeCode(employee.zk),
      normalizeCode(employee.finalCode),
      normalizeCode(employee.saber),
    ].filter(Boolean);

    codes.forEach((code) => {
      if (!byCode.has(code)) {
        byCode.set(code, []);
      }

      byCode.get(code).push(employee);
    });

    const nameKey = normalizeName(employee.fullName);
    if (nameKey) {
      if (!byName.has(nameKey)) {
        byName.set(nameKey, []);
      }

      byName.get(nameKey).push(employee);
    }
  });

  return { byCode, byName };
}

function excelSerialToDate(value) {
  const epoch = Date.UTC(1899, 11, 30);
  const wholeDays = Math.floor(value);
  const dayMilliseconds = 24 * 60 * 60 * 1000;
  const dayFraction = value - wholeDays;
  return new Date(epoch + wholeDays * dayMilliseconds + Math.round(dayFraction * dayMilliseconds));
}

function parseExcelDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = excelSerialToDate(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const raw = cleanText(value);
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const parsed = excelSerialToDate(Number(raw));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const normalized = raw.replace(/\./g, '/');
  const numericMatch = normalized.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );

  if (numericMatch) {
    const month = Number(numericMatch[1]) - 1;
    const day = Number(numericMatch[2]);
    const year = Number(numericMatch[3]);
    const hours = Number(numericMatch[4] || 0);
    const minutes = Number(numericMatch[5] || 0);
    const seconds = Number(numericMatch[6] || 0);
    const parsed = new Date(year, month, day, hours, minutes, seconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatIsoDateTime(date) {
  const day = formatIsoDate(date);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${day}T${hours}:${minutes}:${seconds}`;
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

function formatMinutesAsClock(totalMinutes) {
  const safeMinutes = Math.max(0, Number(totalMinutes || 0));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function excelFractionToClock(value) {
  if (!Number.isFinite(value)) return '';
  const totalMinutes = Math.round(value * 24 * 60);
  return formatMinutesAsClock(totalMinutes);
}

function parseHeaderYear(titleValue) {
  const match = cleanText(titleValue).match(/20\d{2}/);
  return match ? Number(match[0]) : new Date().getFullYear();
}

function parseWeeklyIsoDate(label, fallbackYear) {
  const match = cleanText(label).match(/(\d{2})\/(\d{2})/);
  if (!match) return '';

  const day = match[1];
  const month = match[2];
  return `${fallbackYear}-${month}-${day}`;
}

function parseWeeklyCellValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      raw: value,
      display: excelFractionToClock(value),
      status: 'POINTAGE',
    };
  }

  const text = cleanText(value);
  if (!text) {
    return {
      raw: '',
      display: '',
      status: 'EMPTY',
    };
  }

  const normalized = normalizeLooseText(text);

  if (normalized === 'ABS') {
    return { raw: text, display: 'ABS', status: 'ABS' };
  }

  if (normalized === 'CM') {
    return { raw: text, display: 'CM', status: 'CM' };
  }

  if (normalized.startsWith('CONG')) {
    return { raw: text, display: 'Conge', status: 'CONGE' };
  }

  if (normalized === 'REPOS') {
    return { raw: text, display: 'Repos', status: 'REPOS' };
  }

  if (normalized === 'STC') {
    return { raw: text, display: 'STC', status: 'STC' };
  }

  if (/^\d{2}:\d{2}\s*!$/.test(text)) {
    return { raw: text, display: text, status: 'AVR' };
  }

  return {
    raw: text,
    display: text,
    status: 'TEXT',
  };
}

function isWeeklySheetName(sheetName) {
  return /^S\d+/i.test(cleanText(sheetName));
}

function isMonthlyTotalsSheetName(sheetName) {
  const normalized = normalizeLooseText(sheetName);
  return normalized === 'TOTALMOIS' || normalized.startsWith('TOTALDUMOIS');
}

function isStandardHoursHeader(header) {
  return normalizeLooseText(header).startsWith('HEURESSTANDARD');
}

function isTotalHoursHeader(header) {
  const normalized = normalizeLooseText(header);
  return normalized === 'TOTALH' || normalized === 'TOTAL';
}

function isControlHeader(header) {
  const normalized = normalizeLooseText(header);
  return normalized.startsWith('CONTRO') || normalized.startsWith('CONTR');
}

function getRowCell(row, index) {
  return index >= 0 ? row[index] : '';
}

function findHeaderIndex(headers, matchers) {
  return headers.findIndex((header) => {
    const normalized = normalizeLooseText(header);
    return matchers.some((matcher) =>
      typeof matcher === 'function' ? matcher(normalized) : normalized === matcher,
    );
  });
}

function getSheetRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: '',
  });
}

function parseWeeklySheets(workbook) {
  return workbook.SheetNames.filter((sheetName) => isWeeklySheetName(sheetName))
    .map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = getSheetRows(sheet);
      if (rows.length < 2) {
        return null;
      }

      const title = cleanText(rows[0]?.[0] || sheetName);
      const headers = Array.isArray(rows[1]) ? rows[1] : [];
      const standardHoursIndex = headers.findIndex((header) => isStandardHoursHeader(header));
      const totalIndex = headers.findIndex((header) => isTotalHoursHeader(header));
      const controlIndex = headers.findIndex((header) => isControlHeader(header));
      const dayEndIndex = standardHoursIndex > 5 ? standardHoursIndex : headers.length;
      const headerYear = parseHeaderYear(title);
      const dayColumns = headers
        .slice(5, dayEndIndex)
        .map((label, index) => ({
          columnIndex: index + 5,
          label: cleanText(label),
          isoDate: parseWeeklyIsoDate(label, headerYear),
        }))
        .filter((day) => day.label);

      const weekRows = rows
        .slice(2)
        .map((row) => {
          const id = cleanText(row[0]);
          const lastName = cleanText(row[1]);
          const firstName = cleanText(row[2]);
          const department = cleanText(row[3]);
          const kind = cleanText(row[4]);

          if (!id && !lastName && !firstName) {
            return null;
          }

          const fullName = `${lastName} ${firstName}`.trim();
          const days = dayColumns.map((day) => {
            const parsed = parseWeeklyCellValue(row[day.columnIndex]);
            return {
              ...parsed,
              label: day.label,
              isoDate: day.isoDate,
            };
          });

          return {
            employeeKey: normalizeCode(id) || normalizeName(fullName) || `${sheetName}-${fullName}`,
            id,
            lastName,
            firstName,
            fullName,
            department,
            kind,
            control: cleanText(getRowCell(row, controlIndex)),
            totalHours: cleanText(getRowCell(row, totalIndex)),
            days,
          };
        })
        .filter(Boolean);

      return {
        sheetName,
        weekId: cleanText(sheetName.split('_')[0]) || sheetName,
        title,
        dayColumns,
        rows: weekRows,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sheetName.localeCompare(right.sheetName));
}

function findMonthlyTotalsSheet(workbook) {
  const sheetName = workbook.SheetNames.find((name) => {
    if (isMonthlyTotalsSheetName(name)) {
      return true;
    }

    const rows = getSheetRows(workbook.Sheets[name]);
    return normalizeLooseText(rows[0]?.[0] || '').startsWith('TOTALDUMOIS');
  });

  if (!sheetName) {
    return null;
  }

  const rows = getSheetRows(workbook.Sheets[sheetName]);
  const headers = Array.isArray(rows[1]) ? rows[1] : [];
  const usableRows = rows
    .slice(2)
    .filter((row) => cleanText(row[0]) || cleanText(row[1]) || cleanText(row[2])).length;

  return {
    sheetName,
    title: cleanText(rows[0]?.[0] || sheetName),
    totalRows: Math.max(0, rows.length - 2),
    usableRows,
    uniqueEmployees: usableRows,
    trackedDays: headers.filter((header) => isWeeklySheetName(header)).length,
    punchCount: 0,
  };
}

function findSourcePointageLayout(rows) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const headers = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    if (!headers.length) {
      continue;
    }

    const idIndex = findHeaderIndex(headers, ['IDEMP', (value) => value.startsWith('IDEMP')]);
    const nameIndex = findHeaderIndex(headers, [
      'NOM',
      (value) => value.startsWith('NOM'),
      (value) => value.includes('NOM'),
    ]);
    const timeIndex = findHeaderIndex(headers, [
      'TEMPSDUPTG',
      (value) => value.startsWith('TEMPSDUPTG'),
      (value) => value.includes('TEMPS') && value.includes('PTG'),
    ]);

    if (idIndex < 0 || nameIndex < 0 || timeIndex < 0) {
      continue;
    }

    return {
      rowIndex,
      selectionIndex: findHeaderIndex(headers, [
        'SELECTION',
        (value) => value.startsWith('SELECTION'),
        'COCHE',
      ]),
      idIndex,
      nameIndex,
      timeIndex,
      workCodeIndex: findHeaderIndex(headers, ['WORKCODE', (value) => value.startsWith('WORKCODE')]),
      pointageStateIndex: findHeaderIndex(headers, [
        'ETATDUPTG',
        (value) => value.startsWith('ETAT') && value.includes('PTG'),
        'CHECKSTATUS',
      ]),
      terminalIndex: findHeaderIndex(headers, ['TERMINAL', (value) => value.startsWith('TERMINAL')]),
      pointageTypeIndex: findHeaderIndex(headers, [
        'TYPEDUPTG',
        (value) => value.startsWith('TYPE') && value.includes('PTG'),
      ]),
    };
  }

  return null;
}

function findSourcePointageSheet(workbook) {
  const exactMatch = workbook.SheetNames.find(
    (sheetName) => normalizeLooseText(sheetName) === 'SOURCEPOINTAGE',
  );

  if (exactMatch) {
    return exactMatch;
  }

  return (
    workbook.SheetNames.find((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = getSheetRows(sheet);
      return Boolean(findSourcePointageLayout(rows));
    }) || ''
  );
}

function buildWeeklyDateList(weeklySheets) {
  return [...new Set(
    weeklySheets.flatMap((sheet) => sheet.dayColumns.map((day) => day.isoDate).filter(Boolean)),
  )].sort();
}

function getStatusLabel(matchState, matchMethod) {
  if (matchState === 'unmatched') return 'Introuvable';
  if (matchState === 'review') return matchMethod || 'A verifier';
  return matchMethod || 'OK';
}

function matchEmployee(sourceId, sourceName, employeeIndex) {
  const normalizedCode = normalizeCode(sourceId);
  const normalizedName = normalizeName(sourceName);
  const codeCandidates = normalizedCode ? employeeIndex.byCode.get(normalizedCode) || [] : [];

  if (codeCandidates.length === 1) {
    return {
      employee: codeCandidates[0],
      matchState: 'matched',
      matchMethod: 'Code exact',
    };
  }

  if (codeCandidates.length > 1) {
    const exactNameCandidates = codeCandidates.filter(
      (employee) => normalizeName(employee.fullName) === normalizedName,
    );

    if (exactNameCandidates.length === 1) {
      return {
        employee: exactNameCandidates[0],
        matchState: 'matched',
        matchMethod: 'Code + nom',
      };
    }

    return {
      employee: exactNameCandidates[0] || codeCandidates[0],
      matchState: 'review',
      matchMethod: 'Doublon code',
    };
  }

  const nameCandidates = normalizedName ? employeeIndex.byName.get(normalizedName) || [] : [];

  if (nameCandidates.length === 1) {
    return {
      employee: nameCandidates[0],
      matchState: 'matched',
      matchMethod: 'Nom exact',
    };
  }

  if (nameCandidates.length > 1) {
    return {
      employee: nameCandidates[0],
      matchState: 'review',
      matchMethod: 'Doublon nom',
    };
  }

  return {
    employee: null,
    matchState: 'unmatched',
    matchMethod: 'Introuvable',
  };
}

function createCountMap(items, getKey) {
  const counts = new Map();

  items.forEach((item) => {
    const key = cleanText(getKey(item));
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return counts;
}

function toCoverageArray(baseCounts, fileCounts) {
  const totalFile = [...fileCounts.values()].reduce((sum, count) => sum + count, 0);

  return [...new Set([...baseCounts.keys(), ...fileCounts.keys()])]
    .sort((left, right) => left.localeCompare(right))
    .map((label) => {
      const baseCount = baseCounts.get(label) || 0;
      const fileCount = fileCounts.get(label) || 0;

      return {
        label,
        baseCount,
        fileCount,
        coveragePercent: baseCount ? (fileCount / baseCount) * 100 : 0,
        sharePercent: totalFile ? (fileCount / totalFile) * 100 : 0,
      };
    });
}

function buildExportRows(analysis) {
  const summaryRows = [
    {
      indicateur: 'Fichier',
      valeur: analysis.fileName,
    },
    {
      indicateur: 'Feuilles analysees',
      valeur: analysis.sheetCount,
    },
    {
      indicateur: 'Jours de presence',
      valeur: analysis.summary.trackedDays,
    },
    {
      indicateur: 'Lignes exploitables',
      valeur: analysis.summary.usableRows,
    },
    {
      indicateur: 'Employes uniques reconnus',
      valeur: analysis.summary.matchedEmployees,
    },
    {
      indicateur: 'Employes introuvables',
      valeur: analysis.summary.unmatchedEmployees,
    },
    {
      indicateur: 'Employes a verifier',
      valeur: analysis.summary.reviewEmployees,
    },
    {
      indicateur: 'Jours impairs',
      valeur: analysis.summary.oddDayCount,
    },
    {
      indicateur: 'Couverture employes actifs',
      valeur: `${analysis.summary.activeCoveragePercent.toFixed(1)}%`,
    },
  ];

  const sheetsRows = analysis.sheetSummaries.map((sheet) => ({
    feuille: sheet.sheetName,
    lignes_brutes: sheet.totalRows,
    lignes_exploitables: sheet.usableRows,
    employes_uniques: sheet.uniqueEmployees,
    jours_suivis: sheet.trackedDays,
    pointages: sheet.punchCount,
  }));

  const dailyRows = analysis.dailySummaries.map((day) => ({
    date: day.isoDate,
    employes_pointes: day.presentEmployees,
    employes_reconnus: day.matchedEmployees,
    employes_introuvables: day.unmatchedEmployees,
    employes_a_verifier: day.reviewEmployees,
    jours_impairs: day.oddEntries,
    pointages: day.punchCount,
    heures_arrondies: day.totalRoundedClock,
  }));

  const weeklyRows = (analysis.weeklySheets || []).flatMap((sheet) =>
    sheet.rows.map((row) => ({
      feuille: sheet.sheetName,
      semaine: sheet.weekId,
      nom: row.fullName,
      departement: row.department,
      categorie: row.kind,
      controle: row.control,
      jours: row.days
        .map((day) => `${day.label}: ${day.display || '-'}`)
        .join(' | '),
    })),
  );

  const employeesRows = analysis.employeeRows.map((row) => ({
    source_id: row.sourceId,
    nom_fichier: row.sourceName,
    nom_base: row.matchedName,
    statut_controle: row.statusLabel,
    type: row.kind,
    departement: row.department,
    service: row.service,
    statut_employe: row.employeeStatus,
    jours_pointes: row.daysCount,
    jours_ok: row.okDayCount,
    jours_impairs: row.oddDayCount,
    heures_arrondies: row.totalRoundedClock,
    premiere_date: row.firstSeenDate,
    derniere_date: row.lastSeenDate,
  }));

  const rawRows = analysis.rawRows.map((row) => ({
    feuille: row.sheetName,
    selection: row.selection,
    source_id: row.sourceId,
    source_name: row.sourceName,
    matched_name: row.matchedName,
    statut_controle: row.statusLabel,
    date_pointage: row.pointageAtDisplay,
    iso_date: row.isoDate,
    terminal: row.terminal,
    type_pointage: row.pointageType,
    departement: row.department,
    service: row.service,
    type_employe: row.kind,
    statut_employe: row.employeeStatus,
  }));

  return { summaryRows, sheetsRows, dailyRows, weeklyRows, employeesRows, rawRows };
}

export async function analyzePointageFile(file, employees) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
  const weeklySheets = parseWeeklySheets(workbook);
  const monthlySheet = findMonthlyTotalsSheet(workbook);
  const weeklyDates = buildWeeklyDateList(weeklySheets);

  if (!workbook.SheetNames.length) {
    throw new Error('Le fichier Excel ne contient aucune feuille.');
  }

  const employeeIndex = buildEmployeeIndex(employees);
  const activeEmployees = employees.filter(
    (employee) => cleanText(employee.status).toLowerCase() === 'actif',
  );
  const rawRows = [];
  const dayMap = new Map();
  const employeeRowsMap = new Map();
  const reviewKeys = new Set();
  const unmatchedKeys = new Set();
  const sheetStatsMap = new Map();
  const sourcePointageSheetName = findSourcePointageSheet(workbook);

  if (!sourcePointageSheetName) {
    throw new Error('La feuille SOURCE_POINTAGE est introuvable dans ce fichier.');
  }

  const sourceSheet = workbook.Sheets[sourcePointageSheetName];
  const sourceRows = getSheetRows(sourceSheet);
  const sourceLayout = findSourcePointageLayout(sourceRows);
  const headerRowIndex = sourceLayout?.rowIndex ?? -1;

  if (headerRowIndex < 0) {
    throw new Error('La structure de SOURCE_POINTAGE est invalide.');
  }

  sheetStatsMap.set(sourcePointageSheetName, {
    sheetName: sourcePointageSheetName,
    totalRows: Math.max(0, sourceRows.length - (headerRowIndex + 1)),
    usableRows: 0,
    employeeKeys: new Set(),
    isoDates: new Set(),
    punchCount: 0,
  });

  const sourceStats = sheetStatsMap.get(sourcePointageSheetName);

  sourceRows.slice(headerRowIndex + 1).forEach((row, rowIndex) => {
    const sourceId = cleanText(getRowCell(row, sourceLayout.idIndex));
    const sourceName = cleanText(getRowCell(row, sourceLayout.nameIndex));
    const pointageDate = parseExcelDate(getRowCell(row, sourceLayout.timeIndex));

    if (!pointageDate || (!sourceId && !sourceName)) {
      return;
    }

    const match = matchEmployee(sourceId, sourceName, employeeIndex);
    const matchedEmployee = match.employee;
    const employeeKey = matchedEmployee
      ? buildEmployeeKey(matchedEmployee)
      : `${normalizeCode(sourceId)}|${normalizeName(sourceName)}` || `row-${rowIndex + 1}`;
    const isoDate = formatIsoDate(pointageDate);
    const safeSourceName = sourceName || '-';
    const matchedName = matchedEmployee?.fullName || safeSourceName.toUpperCase();
    const department = matchedEmployee?.department || '';
    const service = matchedEmployee?.service || '';
    const kind = matchedEmployee?.kind || '';
    const employeeStatus = matchedEmployee?.status || '';
    const statusLabel = getStatusLabel(match.matchState, match.matchMethod);

    const enrichedRow = {
      rowNumber: headerRowIndex + rowIndex + 2,
      sheetName: sourcePointageSheetName,
      selection: cleanText(getRowCell(row, sourceLayout.selectionIndex)),
      sourceId,
      sourceName: safeSourceName,
      matchedName,
      pointageAt: formatIsoDateTime(pointageDate),
      pointageAtDisplay: formatFrDateTime(pointageDate),
      isoDate,
      workCode: cleanText(getRowCell(row, sourceLayout.workCodeIndex)),
      pointageState: cleanText(getRowCell(row, sourceLayout.pointageStateIndex)),
      terminal: cleanText(getRowCell(row, sourceLayout.terminalIndex)),
      pointageType: cleanText(getRowCell(row, sourceLayout.pointageTypeIndex)),
      department,
      service,
      kind,
      employeeStatus,
      matchState: match.matchState,
      matchMethod: match.matchMethod,
      statusLabel,
      employeeKey,
      matchedRecordId: matchedEmployee?.recordId || '',
    };

    rawRows.push(enrichedRow);
    sourceStats.usableRows += 1;
    sourceStats.employeeKeys.add(employeeKey);
    sourceStats.isoDates.add(isoDate);
    sourceStats.punchCount += 1;

    if (!employeeRowsMap.has(employeeKey)) {
      employeeRowsMap.set(employeeKey, {
        employeeKey,
        sourceId,
        sourceName: safeSourceName,
        matchedName,
        department,
        service,
        kind,
        employeeStatus,
        matchState: match.matchState,
        matchMethod: match.matchMethod,
        statusLabel,
        matchedRecordId: matchedEmployee?.recordId || '',
        sheets: new Set(),
        punches: [],
        dayKeys: new Set(),
        okDayCount: 0,
        oddDayCount: 0,
        totalRoundedMinutes: 0,
        firstSeenAt: pointageDate,
        lastSeenAt: pointageDate,
      });
    }

    const employeeRow = employeeRowsMap.get(employeeKey);
    employeeRow.punches.push(pointageDate);
    employeeRow.sheets.add(sourcePointageSheetName);
    employeeRow.dayKeys.add(isoDate);
    if (pointageDate < employeeRow.firstSeenAt) employeeRow.firstSeenAt = pointageDate;
    if (pointageDate > employeeRow.lastSeenAt) employeeRow.lastSeenAt = pointageDate;

    const dayKey = `${employeeKey}|${isoDate}`;
    if (!dayMap.has(dayKey)) {
      dayMap.set(dayKey, {
        employeeKey,
        isoDate,
        sourceId,
        sourceName: safeSourceName,
        matchedName,
        department,
        service,
        kind,
        employeeStatus,
        matchState: match.matchState,
        matchMethod: match.matchMethod,
        statusLabel,
        sheetNames: new Set(),
        punches: [],
      });
    }

    const dayEntry = dayMap.get(dayKey);
    dayEntry.punches.push(pointageDate);
    dayEntry.sheetNames.add(sourcePointageSheetName);

    if (match.matchState === 'review') {
      reviewKeys.add(employeeKey);
    } else if (match.matchState === 'unmatched') {
      unmatchedKeys.add(employeeKey);
    }
  });

  if (!rawRows.length) {
    throw new Error('Le fichier pointage est vide ou non exploitable dans SOURCE_POINTAGE.');
  }

  const dayRows = [...dayMap.values()]
    .map((dayRow) => {
      const sortedPunches = [...dayRow.punches].sort((left, right) => left - right);
      const isOdd = sortedPunches.length % 2 !== 0;
      const firstPunch = sortedPunches[0];
      const lastPunch = sortedPunches[sortedPunches.length - 1];
      const bruteMinutes = isOdd ? 0 : Math.max(0, Math.round((lastPunch - firstPunch) / 60000));
      const afterBreakMinutes = isOdd ? 0 : Math.max(0, bruteMinutes - 30);
      const roundedMinutes = isOdd ? 0 : Math.floor(afterBreakMinutes / 30) * 30;

      const employeeRow = employeeRowsMap.get(dayRow.employeeKey);
      if (employeeRow) {
        if (isOdd) {
          employeeRow.oddDayCount += 1;
        } else {
          employeeRow.okDayCount += 1;
          employeeRow.totalRoundedMinutes += roundedMinutes;
        }
      }

      return {
        ...dayRow,
        sheetNames: [...dayRow.sheetNames].sort(),
        sheetCount: dayRow.sheetNames.size,
        punchesDisplay: sortedPunches.map((date) => formatFrDateTime(date)).join(' | '),
        entry: firstPunch ? formatFrDateTime(firstPunch) : '',
        exit: !isOdd && lastPunch ? formatFrDateTime(lastPunch) : '',
        bruteMinutes,
        afterBreakMinutes,
        roundedMinutes,
        roundedClock: formatMinutesAsClock(roundedMinutes),
        state: isOdd ? 'A verifier' : 'OK',
      };
    })
    .sort((left, right) => {
      const dateSort = left.isoDate.localeCompare(right.isoDate);
      if (dateSort !== 0) return dateSort;
      return left.matchedName.localeCompare(right.matchedName);
    });

  const employeeRows = [...employeeRowsMap.values()]
    .map((row) => ({
      ...row,
      sheetNames: [...row.sheets].sort(),
      sheetCount: row.sheets.size,
      daysCount: row.dayKeys.size,
      punchCount: row.punches.length,
      totalRoundedClock: formatMinutesAsClock(row.totalRoundedMinutes),
      firstSeenDate: formatIsoDate(row.firstSeenAt),
      lastSeenDate: formatIsoDate(row.lastSeenAt),
      isActive: cleanText(row.employeeStatus).toLowerCase() === 'actif',
    }))
    .sort((left, right) => {
      const departmentSort = cleanText(left.department).localeCompare(cleanText(right.department));
      if (departmentSort !== 0) return departmentSort;
      return cleanText(left.matchedName).localeCompare(cleanText(right.matchedName));
    });

  const matchedActiveEmployees = employeeRows.filter(
    (row) => row.isActive && row.matchState !== 'unmatched',
  );
  const matchedEmployees = employeeRows.filter((row) => row.matchState !== 'unmatched');
  const baseKindCounts = createCountMap(activeEmployees, (employee) => employee.kind);
  const fileKindCounts = createCountMap(matchedActiveEmployees, (employee) => employee.kind);
  const baseDepartmentCounts = createCountMap(activeEmployees, (employee) => employee.department);
  const fileDepartmentCounts = createCountMap(matchedActiveEmployees, (employee) => employee.department);
  const uniqueDates = weeklyDates.length ? weeklyDates : [...new Set(dayRows.map((row) => row.isoDate))].sort();
  const weeklySheetSummaries = weeklySheets.map((sheet) => ({
    sheetName: sheet.sheetName,
    totalRows: sheet.rows.length,
    usableRows: sheet.rows.length,
    uniqueEmployees: new Set(sheet.rows.map((row) => row.employeeKey)).size,
    trackedDays: sheet.dayColumns.length,
    punchCount: 0,
  }));
  const sourceSheetSummaries = [...sheetStatsMap.values()].map((sheet) => ({
    sheetName: sheet.sheetName,
    totalRows: sheet.totalRows,
    usableRows: sheet.usableRows,
    uniqueEmployees: sheet.employeeKeys.size,
    trackedDays: sheet.isoDates.size,
    punchCount: sheet.punchCount,
  }));
  const sheetSummaries = [...weeklySheetSummaries, ...(monthlySheet ? [monthlySheet] : []), ...sourceSheetSummaries]
    .sort((left, right) => left.sheetName.localeCompare(right.sheetName));
  const dailySummaries = uniqueDates.map((isoDate) => {
    const items = dayRows.filter((row) => row.isoDate === isoDate);
    const matchedItems = items.filter((row) => row.matchState !== 'unmatched');
    const reviewItems = items.filter((row) => row.matchState === 'review');
    const unmatchedItems = items.filter((row) => row.matchState === 'unmatched');
    const oddItems = items.filter((row) => row.state === 'A verifier');
    const totalRoundedMinutes = items.reduce((sum, row) => sum + Number(row.roundedMinutes || 0), 0);
    const punchCount = items.reduce((sum, row) => sum + row.punches.length, 0);

    return {
      isoDate,
      presentEmployees: items.length,
      matchedEmployees: matchedItems.length,
      reviewEmployees: reviewItems.length,
      unmatchedEmployees: unmatchedItems.length,
      oddEntries: oddItems.length,
      punchCount,
      totalRoundedMinutes,
      totalRoundedClock: formatMinutesAsClock(totalRoundedMinutes),
    };
  });

  const summary = {
    totalRows: sourceStats.totalRows,
    usableRows: rawRows.length,
    matchedRows: rawRows.filter((row) => row.matchState !== 'unmatched').length,
    reviewRows: rawRows.filter((row) => row.matchState === 'review').length,
    unmatchedRows: rawRows.filter((row) => row.matchState === 'unmatched').length,
    matchedEmployees: matchedEmployees.length,
    reviewEmployees: reviewKeys.size,
    unmatchedEmployees: unmatchedKeys.size,
    activeEmployeesTotal: activeEmployees.length,
    activeMatchedEmployees: matchedActiveEmployees.length,
    activeCoveragePercent: activeEmployees.length
      ? (matchedActiveEmployees.length / activeEmployees.length) * 100
      : 0,
    oddDayCount: dayRows.filter((row) => row.state === 'A verifier').length,
    trackedDays: weeklyDates.length || uniqueDates.length,
  };

  const relevantSheetNames = [
    ...new Set(
      [
        ...weeklySheets.map((sheet) => sheet.sheetName),
        monthlySheet?.sheetName || '',
        sourcePointageSheetName,
      ].filter(Boolean),
    ),
  ];

  return {
    fileName: file.name,
    sheetCount: relevantSheetNames.length,
    sheetNames: relevantSheetNames,
    weeklySheets,
    generatedAt: new Date().toISOString(),
    summary,
    rawRows,
    dayRows,
    dailySummaries,
    sheetSummaries,
    employeeRows,
    kindCoverage: toCoverageArray(baseKindCounts, fileKindCounts),
    departmentCoverage: toCoverageArray(baseDepartmentCounts, fileDepartmentCounts),
  };
}

export function exportPointageAnalysis(analysis) {
  const workbook = XLSX.utils.book_new();
  const { summaryRows, sheetsRows, dailyRows, weeklyRows, employeesRows, rawRows } = buildExportRows(analysis);

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Resume');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheetsRows), 'Feuilles');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(dailyRows), 'Jours');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(weeklyRows), 'Semaines');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(employeesRows), 'Employes');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rawRows), 'Lignes');

  const safeName = cleanText(analysis.fileName).replace(/\.[^.]+$/, '') || 'pointage';
  XLSX.writeFile(workbook, `${safeName}-controle.xlsx`);
}
