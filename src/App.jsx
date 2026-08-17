import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { analyzePointageFile } from './lib/pointageImport';
import {
  createEmptyEmployee,
  deleteEmployeeRecord,
  loadEmployees,
  saveEmployeeRecord,
} from './services/employeeStore';
import { loadPointageSnapshot, replacePointageSnapshot } from './services/pointageSnapshotStore';

const mycLogoUrl = new URL('../MYC beauty innovation TUNISIA @300x-100.png', import.meta.url).href;
const rhManagerAvatarUrl = new URL('./assets/rh-manager-avatar.svg', import.meta.url).href;

const SIDEBAR_ITEMS = [
  {
    key: 'dashboard',
    label: 'Tableau de bord',
    note: 'Vue globale RH',
  },
  {
    key: 'pointage',
    label: 'Pointage quotidien',
    note: 'Liste des presents',
  },
  {
    key: 'employees',
    label: 'Employes',
    note: 'Etat du personnel',
  },
  {
    key: 'departments',
    label: 'Departements',
    note: 'Repartition active',
  },
  {
    key: 'reports',
    label: 'Rapports',
    note: 'Synthese du fichier',
  },
  {
    key: 'absences',
    label: 'Absences & Conges',
    note: 'ABS, CM, conges',
  },
  {
    key: 'settings',
    label: 'Parametres',
    note: 'Import et base',
  },
];

const EMPLOYEE_FORM_FIELDS = [
  { key: 'finalCode', label: 'Code final' },
  { key: 'id', label: 'Matricule' },
  { key: 'fullName', label: 'Nom complet' },
  { key: 'department', label: 'Departement' },
  { key: 'service', label: 'Service' },
  { key: 'kind', label: 'Categorie' },
  { key: 'contract', label: 'Contrat' },
  { key: 'status', label: 'Statut' },
  { key: 'payType', label: 'Type de paie' },
  { key: 'signed', label: 'Contrat signe' },
  { key: 'hiredAt', label: 'Date embauche' },
  { key: 'job', label: 'Poste' },
  { key: 'inactiveFrom', label: 'Inactif depuis' },
];

function formatDateLabel(isoDate) {
  if (!isoDate) return '--';

  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;

  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function parseLooseDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const frMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (frMatch) {
    const day = Number(frMatch[1]);
    const month = Number(frMatch[2]) - 1;
    const year = Number(frMatch[3]);
    const parsed = new Date(year, month, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function getMonthKey(value) {
  const date = parseLooseDate(value);
  if (!date) return '';

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(value) {
  const date = parseLooseDate(value);
  if (!date) return '--';

  return new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatPeriodLabel(startDate, endDate) {
  if (!startDate && !endDate) {
    return '--';
  }

  if (!startDate || !endDate || startDate === endDate) {
    return formatShortDateLabel(startDate || endDate);
  }

  return `${formatShortDateLabel(startDate)} au ${formatShortDateLabel(endDate)}`;
}

function normalizeLookupText(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function isFutureMarkerDay(day) {
  const raw = normalizeLookupText(day?.raw ?? day?.display ?? '');
  return raw === 'X';
}

function getWeeklyCellToken(day) {
  const rawToken = normalizeLookupText(day?.raw ?? day?.display ?? '');
  const statusToken = normalizeLookupText(day?.status ?? '');

  if (rawToken) {
    return rawToken;
  }

  return statusToken;
}

function hasStartedWorkInPeriod(days) {
  return days.some((day) => {
    const token = getWeeklyCellToken(day);
    return Boolean(token) && token !== 'X' && token !== 'EMPTY';
  });
}

function hasWeeklyStc(days) {
  return days.some((day) => getWeeklyCellToken(day) === 'STC');
}

function getFirstStcDateInPeriod(days) {
  const firstStcDay = days.find((day) => getWeeklyCellToken(day) === 'STC');
  if (!firstStcDay) {
    return '';
  }

  if (firstStcDay.isoDate) {
    return formatShortDateLabel(firstStcDay.isoDate);
  }

  return String(firstStcDay.label || 'STC').trim();
}

function getFirstActiveDateInPeriod(days) {
  const firstActiveDay = days.find((day) => {
    const token = getWeeklyCellToken(day);
    return Boolean(token) && token !== 'X' && token !== 'EMPTY';
  });

  return firstActiveDay?.isoDate || '';
}

function buildEmployeeLookup(employees) {
  const byCode = new Map();
  const byName = new Map();

  employees.forEach((employee) => {
    [employee.id, employee.finalCode, employee.zk, employee.saber].forEach((code) => {
      const normalizedCode = normalizeLookupText(code);
      if (normalizedCode && !byCode.has(normalizedCode)) {
        byCode.set(normalizedCode, employee);
      }
    });

    const normalizedName = normalizeLookupText(employee.fullName);
    if (normalizedName && !byName.has(normalizedName)) {
      byName.set(normalizedName, employee);
    }
  });

  return function findEmployeeMatch(row) {
    const codeCandidates = [row?.id, row?.employeeKey];

    for (const candidate of codeCandidates) {
      const normalizedCode = normalizeLookupText(candidate);
      if (normalizedCode && byCode.has(normalizedCode)) {
        return byCode.get(normalizedCode);
      }
    }

    const normalizedName = normalizeLookupText(row?.fullName);
    if (normalizedName && byName.has(normalizedName)) {
      return byName.get(normalizedName);
    }

    return null;
  };
}

function buildPeriodEmployees(snapshot, periodStart, periodEnd, employees) {
  if (!periodStart || !periodEnd || !Array.isArray(snapshot?.weeklySheets)) {
    return [];
  }

  const findEmployeeMatch = buildEmployeeLookup(employees);
  const periodEmployees = new Map();

  snapshot.weeklySheets.forEach((sheet) => {
    const dayIndexes = (sheet.dayColumns || [])
      .map((day, index) => ({ ...day, index }))
      .filter((day) => day.isoDate && day.isoDate >= periodStart && day.isoDate <= periodEnd);

    if (!dayIndexes.length) {
      return;
    }

    (sheet.rows || []).forEach((row, rowIndex) => {
      const periodDays = dayIndexes.map((day) => row.days?.[day.index]).filter(Boolean);

      if (!periodDays.length || !hasStartedWorkInPeriod(periodDays)) {
        return;
      }

      const matchedEmployee = findEmployeeMatch(row);
      const uniqueKey =
        row.employeeKey ||
        row.id ||
        normalizeLookupText(row.fullName) ||
        `${sheet.sheetName || 'period'}-${rowIndex}`;

      if (periodEmployees.has(uniqueKey)) {
        return;
      }

      const isPeriodStc = hasWeeklyStc(periodDays);
      const firstStcDate = isPeriodStc ? getFirstStcDateInPeriod(periodDays) : '';

      periodEmployees.set(uniqueKey, {
        employeeKey: uniqueKey,
        id: row.id || matchedEmployee?.finalCode || matchedEmployee?.id || matchedEmployee?.zk || '-',
        fullName: row.fullName || matchedEmployee?.fullName || '-',
        department: matchedEmployee?.department || row.department || '-',
        kind: matchedEmployee?.kind || row.kind || '-',
        status: isPeriodStc ? 'STC' : matchedEmployee?.status || 'Actif',
        detail: isPeriodStc ? firstStcDate || 'STC' : matchedEmployee?.contract || row.control || '-',
      });
    });
  });

  return [...periodEmployees.values()].sort((left, right) => left.fullName.localeCompare(right.fullName));
}

function buildFirstStcDateMap(snapshot, periodStart, periodEnd) {
  if (!periodStart || !periodEnd || !Array.isArray(snapshot?.weeklySheets)) {
    return new Map();
  }

  const stcMap = new Map();

  snapshot.weeklySheets.forEach((sheet) => {
    const dayIndexes = (sheet.dayColumns || [])
      .map((day, index) => ({ ...day, index }))
      .filter((day) => day.isoDate && day.isoDate >= periodStart && day.isoDate <= periodEnd);

    if (!dayIndexes.length) {
      return;
    }

    (sheet.rows || []).forEach((row, rowIndex) => {
      const uniqueKey =
        row.employeeKey ||
        row.id ||
        normalizeLookupText(row.fullName) ||
        `${sheet.sheetName || 'period'}-${rowIndex}`;

      dayIndexes.forEach((day) => {
        const cell = row.days?.[day.index];
        if (getWeeklyCellToken(cell) !== 'STC') {
          return;
        }

        const currentValue = stcMap.get(uniqueKey);
        if (!currentValue || day.isoDate < currentValue) {
          stcMap.set(uniqueKey, day.isoDate);
        }
      });
    });
  });

  return stcMap;
}

function buildFirstActiveDateMap(snapshot, periodStart, periodEnd) {
  if (!periodStart || !periodEnd || !Array.isArray(snapshot?.weeklySheets)) {
    return new Map();
  }

  const activeMap = new Map();

  snapshot.weeklySheets.forEach((sheet) => {
    const dayIndexes = (sheet.dayColumns || [])
      .map((day, index) => ({ ...day, index }))
      .filter((day) => day.isoDate && day.isoDate >= periodStart && day.isoDate <= periodEnd);

    if (!dayIndexes.length) {
      return;
    }

    (sheet.rows || []).forEach((row, rowIndex) => {
      const uniqueKey =
        row.employeeKey ||
        row.id ||
        normalizeLookupText(row.fullName) ||
        `${sheet.sheetName || 'period'}-${rowIndex}`;
      const periodDays = dayIndexes.map((day) => row.days?.[day.index]).filter(Boolean);
      const firstActiveDate = getFirstActiveDateInPeriod(periodDays);

      if (!firstActiveDate) {
        return;
      }

      const currentValue = activeMap.get(uniqueKey);
      if (!currentValue || firstActiveDate < currentValue) {
        activeMap.set(uniqueKey, firstActiveDate);
      }
    });
  });

  return activeMap;
}

function formatShortDateLabel(isoDate) {
  if (!isoDate) return '--';

  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatDateTimeLabel(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function getTodayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatClockFromMinutes(totalMinutes) {
  const safeMinutes = Math.max(0, Number(totalMinutes || 0));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseWorkedMinutes(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeKindLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (normalized.includes('MOD')) return 'MOD';
  if (normalized.includes('MOI')) return 'MOI';
  return normalized || 'AUTRE';
}

function buildKindComparison(activeEmployees, presentRoster) {
  const baseCounts = new Map();
  const presentCounts = new Map();
  const displayOrder = ['MOI', 'MOD'];

  activeEmployees.forEach((employee) => {
    const key = normalizeKindLabel(employee.kind);
    baseCounts.set(key, (baseCounts.get(key) || 0) + 1);
  });

  presentRoster.forEach((row) => {
    const key = normalizeKindLabel(row.kind);
    presentCounts.set(key, (presentCounts.get(key) || 0) + 1);
  });

  const allKinds = [...new Set([...displayOrder, ...baseCounts.keys(), ...presentCounts.keys()])]
    .filter((label) => label !== 'AUTRE' || baseCounts.get(label) || presentCounts.get(label));

  return allKinds.map((label) => {
    const baseCount = baseCounts.get(label) || 0;
    const presentCount = presentCounts.get(label) || 0;

    return {
      label,
      baseCount,
      presentCount,
      percent: baseCount ? (presentCount / baseCount) * 100 : 0,
    };
  });
}

function buildDepartmentComparison(activeEmployees, presentRoster) {
  const baseCounts = new Map();
  const presentCounts = new Map();

  activeEmployees.forEach((employee) => {
    const key = String(employee.department || 'Autres').trim() || 'Autres';
    baseCounts.set(key, (baseCounts.get(key) || 0) + 1);
  });

  presentRoster.forEach((row) => {
    const key = String(row.department || 'Autres').trim() || 'Autres';
    presentCounts.set(key, (presentCounts.get(key) || 0) + 1);
  });

  return [...new Set([...baseCounts.keys(), ...presentCounts.keys()])]
    .map((label) => {
      const baseCount = baseCounts.get(label) || 0;
      const presentCount = presentCounts.get(label) || 0;

      return {
        label,
        baseCount,
        presentCount,
        percent: baseCount ? (presentCount / baseCount) * 100 : 0,
      };
    })
    .sort((left, right) => {
      if (right.presentCount !== left.presentCount) {
        return right.presentCount - left.presentCount;
      }

      return left.label.localeCompare(right.label);
    });
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    return false;
  }

  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

function getOperationalWeeklySheets(snapshot) {
  if (!Array.isArray(snapshot?.weeklySheets)) {
    return [];
  }

  return snapshot.weeklySheets.filter((sheet) => {
    const weekCode = String(sheet?.weekId || sheet?.sheetName || '');
    if (!/^S\d+/i.test(weekCode)) {
      return false;
    }

    return Array.isArray(sheet?.dayColumns) && sheet.dayColumns.some((day) => isValidIsoDate(day?.isoDate));
  });
}

function getAvailableDates(snapshot) {
  return [
    ...new Set(
      getOperationalWeeklySheets(snapshot).flatMap((sheet) => sheet.dayColumns?.map((day) => day.isoDate) || []),
    ),
  ]
    .filter((date) => isValidIsoDate(date))
    .sort();
}

function getDefaultSelectedDate(snapshot) {
  const dates = getAvailableDates(snapshot);
  if (!dates.length) {
    return '';
  }

  const today = getTodayIsoDate();
  if (dates.includes(today)) {
    return today;
  }

  return dates[dates.length - 1];
}

function getSelectedWeek(snapshot, selectedDate) {
  const weeklySheets = getOperationalWeeklySheets(snapshot);
  if (!weeklySheets.length) {
    return null;
  }

  return (
    weeklySheets.find((sheet) =>
      sheet.dayColumns?.some((day) => day.isoDate === selectedDate),
    ) || weeklySheets[0] || null
  );
}

function getSelectedRows(snapshot, selectedDate) {
  if (!Array.isArray(snapshot?.dayRows)) {
    return [];
  }

  return snapshot.dayRows
    .filter((row) => row.isoDate === selectedDate)
    .sort((left, right) => {
      const departmentSort = String(left.department || '').localeCompare(String(right.department || ''));
      if (departmentSort !== 0) return departmentSort;
      return String(left.matchedName || '').localeCompare(String(right.matchedName || ''));
    });
}

function getSelectedDayIndex(week, selectedDate) {
  if (!Array.isArray(week?.dayColumns)) {
    return -1;
  }

  return week.dayColumns.findIndex((day) => day.isoDate === selectedDate);
}

function getDayStatusMeta(day) {
  if (!day) {
    return {
      code: 'EMPTY',
      label: 'Aucune donnee',
      tone: 'neutral',
      isPresent: false,
    };
  }

  const statusValue = String(day.status || '').toUpperCase();
  const token = getWeeklyCellToken(day);

  switch (statusValue) {
    case 'POINTAGE':
      return { code: 'POINTAGE', label: 'Present', tone: 'green', isPresent: true };
    case 'AVR':
      return { code: 'AVR', label: 'A verifier', tone: 'orange', isPresent: true };
    case 'ABS':
      return { code: 'ABS', label: 'Absent', tone: 'red', isPresent: false };
    case 'CM':
      return { code: 'CM', label: 'Conge maladie', tone: 'violet', isPresent: false };
    case 'CONGE':
      return { code: 'CONGE', label: 'Conge', tone: 'violet', isPresent: false };
    case 'REPOS':
      return { code: 'REPOS', label: 'Repos', tone: 'slate', isPresent: false };
    case 'STC':
      return { code: 'STC', label: 'STC', tone: 'blue', isPresent: false };
    default:
      if (token === 'X') {
        return { code: 'X', label: 'Non demarre', tone: 'neutral', isPresent: false };
      }

      if (token === 'STC') {
        return { code: 'STC', label: 'STC', tone: 'blue', isPresent: false };
      }

      if (token === 'ABS') {
        return { code: 'ABS', label: 'Absent', tone: 'red', isPresent: false };
      }

      if (token === 'CM') {
        return { code: 'CM', label: 'Conge maladie', tone: 'violet', isPresent: false };
      }

      if (token === 'CSS' || token.startsWith('CONG')) {
        return { code: 'CONGE', label: 'Conge', tone: 'violet', isPresent: false };
      }

      if (token === 'REPOS') {
        return { code: 'REPOS', label: 'Repos', tone: 'slate', isPresent: false };
      }

      if (parseWorkedMinutes(day.display) > 0) {
        return { code: 'POINTAGE', label: 'Present', tone: 'green', isPresent: true };
      }

      return {
        code: 'TEXT',
        label: day.display || '-',
        tone: 'neutral',
        isPresent: false,
      };
  }
}

function isPresentWeeklyCell(day) {
  return getDayStatusMeta(day).isPresent;
}

function buildWeeklyFallbackMetrics(selectedWeek, selectedDate) {
  const dayIndex = getSelectedDayIndex(selectedWeek, selectedDate);
  if (dayIndex < 0) {
    return {
      presentEmployees: 0,
      totalRoundedMinutes: 0,
      totalRoundedClock: '--:--',
      rows: [],
    };
  }

  const rows = Array.isArray(selectedWeek?.rows) ? selectedWeek.rows : [];
  const presentRows = rows
    .map((row) => {
      const day = row.days?.[dayIndex];
      if (!isPresentWeeklyCell(day)) {
        return null;
      }

      return {
        employeeKey: row.employeeKey,
        matchedName: row.fullName,
        department: row.department,
        kind: row.kind,
        entry: '',
        workedClock: day.display || '',
        workedMinutes: parseWorkedMinutes(day.display),
      };
    })
    .filter(Boolean);

  const totalRoundedMinutes = presentRows.reduce((sum, row) => sum + row.workedMinutes, 0);

  return {
    presentEmployees: presentRows.length,
    totalRoundedMinutes,
    totalRoundedClock: presentRows.length ? formatClockFromMinutes(totalRoundedMinutes) : '00:00',
    rows: presentRows,
  };
}

function buildDayRoster(selectedWeek, selectedDate) {
  const dayIndex = getSelectedDayIndex(selectedWeek, selectedDate);
  if (dayIndex < 0) {
    return [];
  }

  const rows = Array.isArray(selectedWeek?.rows) ? selectedWeek.rows : [];

  return rows
    .map((row) => {
      const day = row.days?.[dayIndex];
      const status = getDayStatusMeta(day);

      return {
        employeeKey: row.employeeKey,
        id: row.id,
        fullName: row.fullName,
        department: row.department,
        kind: row.kind,
        display: day?.display || '-',
        rawDisplay: day?.raw || day?.display || '-',
        totalHours: row.totalHours || '-',
        control: row.control || '-',
        statusCode: status.code,
        statusLabel: status.label,
        statusTone: status.tone,
        isPresent: status.isPresent,
      };
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

function getDepartmentSegments(rows) {
  const total = rows.length || 1;
  const counts = new Map();

  rows.forEach((row) => {
    const key = String(row.department || 'Autres').trim() || 'Autres';
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const palette = ['#2f6df6', '#14c784', '#ff9f1a', '#7c5cff', '#94a3b8', '#e5e7eb'];

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([label, count], index) => ({
      label,
      count,
      percent: (count / total) * 100,
      color: palette[index % palette.length],
    }));
}

function getDonutBackground(segments) {
  if (!segments.length) {
    return 'conic-gradient(#e5e7eb 0 100%)';
  }

  let cursor = 0;
  const parts = segments.map((segment) => {
    const start = cursor;
    const end = cursor + segment.percent;
    cursor = end;
    return `${segment.color} ${start}% ${end}%`;
  });

  return `conic-gradient(${parts.join(', ')})`;
}

function matchesSearch(values, searchValue) {
  const normalizedSearch = String(searchValue || '').trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  return values
    .map((value) => String(value || '').toLowerCase())
    .some((value) => value.includes(normalizedSearch));
}

function sortEmployeeRecords(items) {
  return [...items].sort((left, right) =>
    String(left.fullName || '').localeCompare(String(right.fullName || '')),
  );
}

function buildDepartmentBaseRows(employees) {
  const counts = new Map();

  employees.forEach((employee) => {
    const department = String(employee.department || 'Sans departement').trim() || 'Sans departement';
    const current = counts.get(department) || {
      label: department,
      total: 0,
      active: 0,
      stc: 0,
      moi: 0,
      mod: 0,
      services: new Set(),
    };

    current.total += 1;

    if (String(employee.status || '').toLowerCase() === 'actif') {
      current.active += 1;
    }

    if (String(employee.status || '').toLowerCase() === 'stc') {
      current.stc += 1;
    }

    if (normalizeKindLabel(employee.kind) === 'MOI') {
      current.moi += 1;
    }

    if (normalizeKindLabel(employee.kind) === 'MOD') {
      current.mod += 1;
    }

    if (String(employee.service || '').trim()) {
      current.services.add(String(employee.service).trim());
    }

    counts.set(department, current);
  });

  return [...counts.values()]
    .map((item) => ({
      ...item,
      serviceCount: item.services.size,
      activeRate: item.total ? (item.active / item.total) * 100 : 0,
    }))
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));
}

function getNextZkValue(employees) {
  const zkValues = employees
    .map((employee) => String(employee.zk || '').trim())
    .filter((value) => /^\d+$/.test(value));

  const maxValue = zkValues.length ? Math.max(...zkValues.map((value) => Number(value))) : 0;
  const width = zkValues.length ? Math.max(3, ...zkValues.map((value) => value.length)) : 3;

  return String(maxValue + 1).padStart(width, '0');
}

function getNextEmployeeCodeValue(employees) {
  const codeValues = employees
    .flatMap((employee) => [
      String(employee.id || '').trim(),
      String(employee.finalCode || '').trim(),
      String(employee.saber || '').trim(),
    ])
    .filter((value) => /^\d+$/.test(value));

  const maxValue = codeValues.length ? Math.max(...codeValues.map((value) => Number(value))) : 0;
  const width = codeValues.length ? Math.max(4, ...codeValues.map((value) => value.length)) : 4;

  return String(maxValue + 1).padStart(width, '0');
}

const TRACKED_ABSENCE_CODES = new Set(['ABS', 'CM', 'CONGE', 'REPOS']);
const HIDDEN_ABSENCE_MARKERS = new Set(['X', 'STC']);

function isHiddenAbsenceMarker(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return HIDDEN_ABSENCE_MARKERS.has(normalized);
}

function getAbsenceDetailLabel(row) {
  const rawDetail = String(row?.rawDisplay || row?.display || '').trim();
  if (!rawDetail || isHiddenAbsenceMarker(rawDetail)) {
    return '';
  }

  return rawDetail;
}

function isTrackedAbsenceRow(row) {
  const statusCode = String(row?.statusCode || '').trim().toUpperCase();
  return TRACKED_ABSENCE_CODES.has(statusCode);
}

function buildAbsenceSummary(rows) {
  const statusOrder = ['ABS', 'CM', 'CONGE', 'REPOS'];
  const counts = new Map();

  rows.forEach((row) => {
    const statusCode = String(row.statusCode || 'AUTRE').toUpperCase();
    const detailLabel = statusCode === 'CONGE' ? getAbsenceDetailLabel(row) : '';
    const key = detailLabel ? `${statusCode}:${detailLabel}` : statusCode;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...new Set([...statusOrder, ...counts.keys()])]
    .filter((key) => (counts.get(key) || 0) > 0)
    .map((key) => {
      const [statusCode, detailLabel] = String(key).split(':');
      const meta = getDayStatusMeta({ status: statusCode, display: detailLabel || statusCode });
      return {
        code: key,
        label: detailLabel || meta.label,
        tone: meta.tone,
        count: counts.get(key) || 0,
      };
    });
}

function exportEmployeeBaseWorkbook(employees, departmentRows) {
  const workbook = XLSX.utils.book_new();
  const employeeSheetRows = employees.map((employee) => ({
    Code: employee.finalCode || employee.id || employee.zk || '',
    Matricule: employee.id || '',
    ZK: employee.zk || '',
    Nom: employee.fullName || '',
    Departement: employee.department || '',
    Service: employee.service || '',
    Categorie: employee.kind || '',
    Contrat: employee.contract || '',
    Statut: employee.status || '',
    Type_Paie: employee.payType || '',
    Contrat_Signe: employee.signed || '',
    Date_Embauche: employee.hiredAt || '',
    Poste: employee.job || '',
    Inactif_Depuis: employee.inactiveFrom || '',
  }));
  const departmentSheetRows = departmentRows.map((department) => ({
    Departement: department.label,
    Total: department.total,
    Actifs: department.active,
    STC: department.stc,
    MOI: department.moi,
    MOD: department.mod,
    Services: department.serviceCount,
    Taux_Actif: Number((department.activeRate || 0).toFixed(2)),
  }));

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(employeeSheetRows), 'Base RH');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(departmentSheetRows), 'Departements');

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `base-rh-detail-${today}.xlsx`);
}

function buildKpiDetailConfig(type, data) {
  const {
    monthlyEffectifEmployees,
    presentRoster,
    absentRoster,
    newRoster,
    stcEmployees,
    selectedDate,
    periodLabel,
    totalEmployees,
    presentEmployees,
    absentEmployees,
    newEmployees,
    stcCount,
  } = data;

  switch (type) {
    case 'present':
      return {
        title: 'Liste des presents',
        subtitle: `Pointage du ${formatDateLabel(selectedDate)} | ${presentEmployees} presents`,
        rows: presentRoster.map((row) => ({
          id: row.id || row.employeeKey || '-',
          fullName: row.fullName || '-',
          department: row.department || '-',
          kind: row.kind || '-',
          status: row.statusLabel || 'Present',
          detail: row.display || '-',
        })),
      };
    case 'absent':
      return {
        title: 'Liste des absents',
        subtitle: `ABS du ${formatDateLabel(selectedDate)} | ${absentEmployees} personnes`,
        rows: absentRoster
          .filter((row) => String(row.statusCode || '').toUpperCase() === 'ABS')
          .map((row) => ({
            id: row.id || row.employeeKey || '-',
            fullName: row.fullName || '-',
            department: row.department || '-',
            kind: row.kind || '-',
            status: row.statusLabel || 'Absent',
            detail: row.rawDisplay || row.display || '-',
          })),
      };
    case 'new':
      return {
        title: 'Liste des nouveaux',
        subtitle: `Nouveaux du ${formatDateLabel(selectedDate)} | ${newEmployees} personnes`,
        rows: newRoster.map((row) => ({
          id: row.id || row.employeeKey || '-',
          fullName: row.fullName || '-',
          department: row.department || '-',
          kind: row.kind || '-',
          status: row.statusLabel || 'Non demarre',
          detail: row.rawDisplay || row.display || 'X',
        })),
      };
    case 'stc':
      return {
        title: 'Liste STC du mois',
        subtitle: `${stcCount} employe(s) STC pour ${periodLabel}`,
        rows: stcEmployees.map((employee) => ({
          id: employee.id || employee.employeeKey || '-',
          fullName: employee.fullName || '-',
          department: employee.department || '-',
          kind: employee.kind || '-',
          status: employee.status || 'STC',
          detail: employee.detail || '-',
        })),
      };
    case 'total':
    default:
      return {
        title: 'Effectif du mois',
        subtitle: `${totalEmployees} employe(s) RH suivis pour ${periodLabel}`,
        rows: monthlyEffectifEmployees.map((employee) => ({
          id: employee.id || employee.employeeKey || '-',
          fullName: employee.fullName || '-',
          department: employee.department || '-',
          kind: employee.kind || '-',
          status: employee.status || 'Actif',
          detail: employee.detail || '-',
        })),
      };
  }
}

function buildEmployeeBaseDetailConfig(type, data) {
  const { employees, activeEmployees, stcEmployees } = data;

  switch (type) {
    case 'active':
      return {
        title: 'Liste des employes actifs',
        subtitle: `${activeEmployees.length} employe(s) actifs dans la base RH`,
        rows: activeEmployees.map((employee) => ({
          id: employee.finalCode || employee.id || employee.zk || '-',
          fullName: employee.fullName || '-',
          department: employee.department || '-',
          kind: employee.kind || '-',
          status: employee.status || 'Actif',
          detail: employee.contract || employee.service || '-',
        })),
      };
    case 'stc':
      return {
        title: 'Liste STC base RH',
        subtitle: `${stcEmployees.length} employe(s) STC dans la base RH`,
        rows: stcEmployees.map((employee) => ({
          id: employee.finalCode || employee.id || employee.zk || '-',
          fullName: employee.fullName || '-',
          department: employee.department || '-',
          kind: employee.kind || '-',
          status: employee.status || 'STC',
          detail: employee.inactiveFrom || employee.contract || '-',
        })),
      };
    case 'all':
    default:
      return {
        title: 'Liste complete base RH',
        subtitle: `${employees.length} fiche(s) dans la base RH`,
        rows: employees.map((employee) => ({
          id: employee.finalCode || employee.id || employee.zk || '-',
          fullName: employee.fullName || '-',
          department: employee.department || '-',
          kind: employee.kind || '-',
          status: employee.status || '-',
          detail: employee.contract || employee.service || '-',
        })),
      };
  }
}

function KpiCard({ tone, label, value, note, isActive = false, onClick }) {
  const Component = onClick ? 'button' : 'article';

  return (
    <Component
      className={`rh-kpi-card${onClick ? ' is-clickable' : ''}${isActive ? ' is-active' : ''}`}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
    >
      <div className={`rh-kpi-card__icon rh-kpi-card__icon--${tone}`} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{note}</p>
      </div>
    </Component>
  );
}

function KpiDetailModal({ config, searchValue, onSearchChange, onClose }) {
  const filteredRows = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();
    if (!normalizedSearch) {
      return config.rows;
    }

    return config.rows.filter((row) =>
      [row.id, row.fullName, row.department, row.kind, row.status, row.detail]
        .map((value) => String(value || '').toLowerCase())
        .some((value) => value.includes(normalizedSearch)),
    );
  }, [config.rows, searchValue]);

  return (
    <div className="rh-modal" role="dialog" aria-modal="true" aria-labelledby="rh-kpi-modal-title">
      <button className="rh-modal__backdrop" type="button" aria-label="Fermer" onClick={onClose} />

      <article className="rh-modal__panel">
        <div className="rh-modal__header">
          <div>
            <p className="rh-eyebrow">Detail KPI</p>
            <h2 id="rh-kpi-modal-title">{config.title}</h2>
            <p>{config.subtitle}</p>
          </div>

          <div className="rh-modal__actions">
            <div className="rh-panel-pill">{filteredRows.length} personnes</div>
            <button className="rh-modal__close" type="button" onClick={onClose}>
              Fermer
            </button>
          </div>
        </div>

        <div className="rh-modal__toolbar">
          <input
            type="search"
            value={searchValue}
            placeholder="Rechercher une personne..."
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>

        <div className="rh-table-wrap rh-modal__table-wrap">
          <table className="rh-table rh-modal__table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nom</th>
                <th>Departement</th>
                <th>Categorie</th>
                <th>Statut</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length ? (
                filteredRows.map((row, index) => (
                  <tr key={`${row.id}-${row.fullName}-${index}`}>
                    <td>{row.id || '-'}</td>
                    <td>{row.fullName || '-'}</td>
                    <td>{row.department || '-'}</td>
                    <td>{row.kind || '-'}</td>
                    <td>{row.status || '-'}</td>
                    <td>{row.detail || '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="rh-table__empty" colSpan={6}>
                    Aucun resultat pour cette recherche.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

function EmployeeEditorModal({
  mode,
  draft,
  deleteCode,
  isSaving,
  isDeleting,
  contractOptions,
  departmentOptions,
  serviceOptions,
  payTypeOptions,
  onChange,
  onSave,
  onDelete,
  onDeleteCodeChange,
  onClose,
}) {
  if (!draft) {
    return null;
  }

  const isDeleteCodeValid = ['123', 'MYC'].includes(String(deleteCode || '').trim().toUpperCase());

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="employee-editor-title">
      <button className="admin-modal__backdrop" type="button" aria-label="Fermer" onClick={onClose} />

      <article className="admin-modal__panel">
        <div className="admin-modal__header">
          <div>
            <p className="rh-eyebrow">Base RH</p>
            <h3 id="employee-editor-title">
              {mode === 'create' ? 'Ajouter un employe' : draft.fullName || 'Modifier la fiche employe'}
            </h3>
            <p>
              {mode === 'create'
                ? 'Complete la fiche puis sauvegarde pour l enregistrer dans la base.'
                : 'Modifie les informations de la fiche puis sauvegarde les changements.'}
            </p>
          </div>

          <div className="admin-modal__actions">
            <button className="ghost-button" type="button" onClick={onClose}>
              Fermer
            </button>
            <button className="primary-button" type="button" disabled={isSaving} onClick={onSave}>
              {isSaving ? 'Sauvegarde...' : mode === 'create' ? 'Ajouter' : 'Enregistrer'}
            </button>
          </div>
        </div>

        <div className="admin-form-grid">
          {EMPLOYEE_FORM_FIELDS.map((field) => {
            const value = draft[field.key] || '';
            const options =
              field.key === 'contract'
                ? contractOptions
                : field.key === 'department'
                  ? departmentOptions
                  : field.key === 'service'
                    ? serviceOptions
                    : field.key === 'payType'
                      ? payTypeOptions
                      : field.key === 'status'
                        ? ['Actif', 'STC', 'Suspendu']
                        : field.key === 'kind'
                          ? ['MOI', 'MOD']
                          : field.key === 'signed'
                            ? ['Oui', 'Oui/E', 'Non']
                            : [];

            return (
              <label className="field-block" key={field.key}>
                <span>{field.label}</span>
                {options.length ? (
                  <select value={value} onChange={(event) => onChange(field.key, event.target.value)}>
                    <option value="">Choisir...</option>
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={value}
                    onChange={(event) => onChange(field.key, event.target.value)}
                  />
                )}
              </label>
            );
          })}
        </div>

        {mode === 'edit' ? (
          <div className="delete-zone">
            <div className="delete-zone__copy">
              <strong>Supprimer cette fiche</strong>
              <span>Entre `123` ou `MYC` pour autoriser la suppression de cet utilisateur.</span>
            </div>
            <div className="delete-zone__actions">
              <input
                className="delete-zone__input"
                type="password"
                value={deleteCode}
                placeholder="Code 123 ou MYC"
                onChange={(event) => onDeleteCodeChange(event.target.value)}
              />
              <button
                className="danger-button"
                type="button"
                disabled={!isDeleteCodeValid || isDeleting}
                onClick={onDelete}
              >
                {isDeleting ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        ) : null}
      </article>
    </div>
  );
}

function EmployeeBaseSurface({
  employees,
  filteredEmployees,
  departmentRows,
  searchValue,
  onSearchChange,
  onCreate,
  onEdit,
  onExport,
  onOpenAll,
  onOpenActive,
  onOpenStc,
  activeEmployeesCount,
  stcEmployeesCount,
  departmentCount,
}) {
  return (
    <article className="admin-table-card">
      <div className="admin-workspace__hero">
        <div>
          <p className="rh-eyebrow">Base RH enregistree</p>
          <h2>Gestion des employes</h2>
          <p>Ajoute, modifie ou supprime un utilisateur directement depuis la base RH sauvegardee.</p>
        </div>

        <div className="admin-workspace__actions">
          <button className="ghost-button" type="button" onClick={onExport}>
            Exporter Excel
          </button>
          <button className="primary-button" type="button" onClick={onCreate}>
            Ajouter un employe
          </button>
        </div>
      </div>

      <div className="admin-stats">
        <button className="admin-stat-card admin-stat-card--button" type="button" onClick={onOpenAll}>
          <span>Fiches RH</span>
          <strong>{employees.length}</strong>
        </button>
        <button className="admin-stat-card admin-stat-card--button" type="button" onClick={onOpenActive}>
          <span>Actifs</span>
          <strong>{activeEmployeesCount}</strong>
        </button>
        <button className="admin-stat-card admin-stat-card--button" type="button" onClick={onOpenStc}>
          <span>STC</span>
          <strong>{stcEmployeesCount}</strong>
        </button>
      </div>

      <div className="admin-table-card__header">
        <div>
          <h3>Base du personnel</h3>
          <p>{departmentCount} departement(s) relies a cette base.</p>
        </div>

        <div className="admin-table-card__tools">
          <input
            className="admin-search"
            type="search"
            value={searchValue}
            placeholder="Rechercher un employe, service, code..."
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      </div>

      <div className="admin-table-card__summary">
        <span>{filteredEmployees.length} fiche(s) visibles</span>
        <span>{departmentRows.length} departement(s) dans la base RH. Clique sur `Modifier` pour ouvrir la fiche.</span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Nom</th>
              <th>Departement</th>
              <th>Service</th>
              <th>Categorie</th>
              <th>Contrat</th>
              <th>Statut</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.length ? (
              filteredEmployees.map((employee, index) => (
                <tr key={`${employee.recordId || employee.finalCode || employee.id}-${index}`}>
                  <td>{employee.finalCode || employee.id || employee.zk || '-'}</td>
                  <td>{employee.fullName || '-'}</td>
                  <td>{employee.department || '-'}</td>
                  <td>{employee.service || '-'}</td>
                  <td>{employee.kind || '-'}</td>
                  <td>{employee.contract || '-'}</td>
                  <td>{employee.status || '-'}</td>
                  <td>
                    <button className="ghost-button ghost-button--small" type="button" onClick={() => onEdit(employee)}>
                      Modifier
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="admin-table__empty" colSpan={8}>
                  Aucun employe trouve pour cette recherche.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function AbsenceSurface({
  selectedDate,
  rows,
  summary,
  searchValue,
  onSearchChange,
}) {
  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        matchesSearch(
          [row.id, row.fullName, row.department, row.kind, row.statusLabel, getAbsenceDetailLabel(row)],
          searchValue,
        ),
      ),
    [rows, searchValue],
  );

  return (
    <article className="rh-card rh-card--base">
      <div className="rh-base-surface">
        <div className="rh-base-surface__hero">
          <div>
            <p className="rh-eyebrow">Suivi des absences</p>
            <h2>ABSENCES & CONGES</h2>
            <p>{formatDateLabel(selectedDate)} | Detail des ABS, CM, conges et repos du jour.</p>
          </div>

          <div className="rh-table-tools">
            <input
              type="search"
              value={searchValue}
              placeholder="Rechercher une absence ou un conge..."
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
        </div>

        <div className="rh-base-metrics">
          {summary.length ? (
            summary.map((item) => (
              <article className="rh-base-metric" key={item.code}>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </article>
            ))
          ) : (
            <article className="rh-base-metric">
              <span>Aucune absence</span>
              <strong>0</strong>
            </article>
          )}
        </div>

        <div className="rh-table-wrap">
          <table className="rh-table">
            <thead>
              <tr>
                <th>ID ZK</th>
                <th>Nom</th>
                <th>Departement</th>
                <th>Categorie</th>
                <th>Type</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length ? (
                filteredRows.map((row, index) => (
                  <tr key={`${row.employeeKey}-${row.id}-${index}`}>
                    <td>{row.id || '-'}</td>
                    <td>{row.fullName || '-'}</td>
                    <td>{row.department || '-'}</td>
                    <td>{row.kind || '-'}</td>
                    <td>
                      <span className={`rh-panel-badge rh-panel-badge--${row.statusTone}`}>
                        {row.statusLabel || '-'}
                      </span>
                    </td>
                    <td>{getAbsenceDetailLabel(row) || '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="rh-table__empty" colSpan={6}>
                    Aucune absence ou aucun conge trouve pour cette recherche.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}

function Sidebar({
  activeSection,
  onSelect,
  periodLabel,
  periodRange,
  latestImportLabel,
  sidebarOpen,
}) {
  return (
    <aside className={`rh-sidebar${sidebarOpen ? ' is-open' : ''}`}>
      <div className="rh-sidebar__brand">
        <img src={mycLogoUrl} alt="MYC Beauty Innovation Tunisia" />
        <div>
          <strong>MYC</strong>
          <span>Beauty Innovation Tunisia</span>
        </div>
      </div>

      <div className="rh-sidebar__label">Navigation</div>

      <nav className="rh-sidebar__nav" aria-label="Dashboard navigation">
        {SIDEBAR_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`rh-sidebar__item${activeSection === item.key ? ' is-active' : ''}`}
            type="button"
            onClick={() => onSelect(item.key)}
          >
            <span className="rh-sidebar__bullet" />
            <span className="rh-sidebar__item-copy">
              <strong>{item.label}</strong>
              <small>{item.note}</small>
            </span>
          </button>
        ))}
      </nav>

      <div className="rh-sidebar__footer">
        <div className="rh-sidebar__period">
          <span>Periode active</span>
          <strong>{periodLabel}</strong>
          <p>{periodRange}</p>
        </div>
        <div className="rh-sidebar__period">
          <span>Dernier import</span>
          <strong>{latestImportLabel}</strong>
          <p>Base RH synchronisee</p>
        </div>
      </div>
    </aside>
  );
}

export default function App() {
  const [employees, setEmployees] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [activeSection, setActiveSection] = useState('dashboard');
  const [statusMessage, setStatusMessage] = useState('Charge le pointage depuis la base ou importe un fichier Excel.');
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeKpiModal, setActiveKpiModal] = useState('');
  const [activeEmployeeBaseModal, setActiveEmployeeBaseModal] = useState('');
  const [kpiSearchValue, setKpiSearchValue] = useState('');
  const [employeeEditorMode, setEmployeeEditorMode] = useState('closed');
  const [employeeDraft, setEmployeeDraft] = useState(null);
  const [deleteCode, setDeleteCode] = useState('');
  const [isEmployeeSaving, setIsEmployeeSaving] = useState(false);
  const [isEmployeeDeleting, setIsEmployeeDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapDashboard() {
      const [employeesResult, snapshotResult] = await Promise.all([
        loadEmployees(),
        loadPointageSnapshot(),
      ]);
      if (cancelled) return;

      setEmployees(Array.isArray(employeesResult.data) ? employeesResult.data : []);
      setSnapshot(snapshotResult.data || null);
      setStatusMessage(snapshotResult.message || employeesResult.message || 'Dashboard RH pret.');
      setSelectedDate(getDefaultSelectedDate(snapshotResult.data));
      setIsLoading(false);
    }

    bootstrapDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);
      setStatusMessage('Analyse du fichier Excel en cours...');
      const nextSnapshot = await analyzePointageFile(file, employees);
      setStatusMessage('Remplacement de la base pointage en cours...');
      const saveResult = await replacePointageSnapshot(nextSnapshot);
      const savedSnapshot = saveResult.data || nextSnapshot;
      setSnapshot(savedSnapshot);
      setSelectedDate(getDefaultSelectedDate(savedSnapshot));
      setStatusMessage(saveResult.message || 'Fichier Excel importe.');
      setActiveSection('dashboard');
    } catch (error) {
      setStatusMessage(error.message || 'Import Excel impossible.');
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  }

  function handleSelectSection(sectionKey) {
    setActiveSection(sectionKey);
    setSidebarOpen(false);
  }

  function handleOpenKpiModal(type) {
    setActiveKpiModal(type);
    setKpiSearchValue('');
  }

  function handleCloseKpiModal() {
    setActiveKpiModal('');
    setKpiSearchValue('');
  }

  function handleOpenEmployeeBaseModal(type) {
    setActiveEmployeeBaseModal(type);
    setKpiSearchValue('');
  }

  function handleCloseEmployeeBaseModal() {
    setActiveEmployeeBaseModal('');
    setKpiSearchValue('');
  }

  function handleOpenCreateEmployee() {
    const nextZk = getNextZkValue(employees);
    const nextCode = getNextEmployeeCodeValue(employees);
    setEmployeeEditorMode('create');
    setEmployeeDraft({
      ...createEmptyEmployee(),
      id: nextCode,
      zk: nextZk,
      saber: nextCode,
      finalCode: nextCode,
    });
    setDeleteCode('');
  }

  function handleOpenEditEmployee(employee) {
    setEmployeeEditorMode('edit');
    setEmployeeDraft({ ...employee });
    setDeleteCode('');
  }

  function handleCloseEmployeeEditor() {
    setEmployeeEditorMode('closed');
    setEmployeeDraft(null);
    setDeleteCode('');
  }

  function handleEmployeeDraftChange(field, value) {
    setEmployeeDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  const availableDates = useMemo(() => getAvailableDates(snapshot), [snapshot]);
  const selectedWeek = useMemo(() => getSelectedWeek(snapshot, selectedDate), [snapshot, selectedDate]);
  const sourceRowsForDate = useMemo(() => getSelectedRows(snapshot, selectedDate), [snapshot, selectedDate]);
  const sourceSummaryForDate = useMemo(
    () => snapshot?.dailySummaries?.find((item) => item.isoDate === selectedDate) || null,
    [snapshot, selectedDate],
  );
  const weeklyFallback = useMemo(
    () => buildWeeklyFallbackMetrics(selectedWeek, selectedDate),
    [selectedWeek, selectedDate],
  );
  const selectedRows = sourceRowsForDate.length ? sourceRowsForDate : weeklyFallback.rows;
  const selectedSummary = sourceRowsForDate.length
    ? sourceSummaryForDate
    : {
        presentEmployees: weeklyFallback.presentEmployees,
        totalRoundedClock: weeklyFallback.totalRoundedClock,
        totalRoundedMinutes: weeklyFallback.totalRoundedMinutes,
      };

  const dayRoster = useMemo(() => buildDayRoster(selectedWeek, selectedDate), [selectedWeek, selectedDate]);
  const activePeriodStart = availableDates[0] || '';
  const activePeriodEnd = availableDates[availableDates.length - 1] || '';
  const activePeriodLabel = useMemo(
    () => formatPeriodLabel(activePeriodStart, activePeriodEnd),
    [activePeriodEnd, activePeriodStart],
  );
  const activeEmployees = useMemo(
    () => employees.filter((employee) => String(employee.status || '').toLowerCase() === 'actif'),
    [employees],
  );
  const stcEmployees = useMemo(
    () => employees.filter((employee) => String(employee.status || '').toLowerCase() === 'stc'),
    [employees],
  );
  const firstStcDateMap = useMemo(
    () => buildFirstStcDateMap(snapshot, activePeriodStart, activePeriodEnd),
    [activePeriodEnd, activePeriodStart, snapshot],
  );
  const firstActiveDateMap = useMemo(
    () => buildFirstActiveDateMap(snapshot, activePeriodStart, activePeriodEnd),
    [activePeriodEnd, activePeriodStart, snapshot],
  );
  const selectedTableEmployees = useMemo(
    () => buildPeriodEmployees(snapshot, activePeriodStart, activePeriodEnd, employees),
    [activePeriodEnd, activePeriodStart, employees, snapshot],
  );
  const selectedDayEffectifRows = useMemo(
    () => dayRoster.filter((row) => !['EMPTY', 'X'].includes(String(row.statusCode || '').toUpperCase())),
    [dayRoster],
  );
  const newRoster = useMemo(
    () =>
      selectedDayEffectifRows
        .filter((row) => firstActiveDateMap.get(row.employeeKey) === selectedDate)
        .map((row) => ({
          ...row,
          statusLabel: 'Nouveau',
          rawDisplay: firstActiveDateMap.get(row.employeeKey)
            ? formatShortDateLabel(firstActiveDateMap.get(row.employeeKey))
            : row.rawDisplay || row.display || '-',
          display: firstActiveDateMap.get(row.employeeKey)
            ? formatShortDateLabel(firstActiveDateMap.get(row.employeeKey))
            : row.display || '-',
        })),
    [firstActiveDateMap, selectedDate, selectedDayEffectifRows],
  );
  const selectedDayStcRows = useMemo(
    () => selectedDayEffectifRows.filter((row) => String(row.statusCode || '').toUpperCase() === 'STC'),
    [selectedDayEffectifRows],
  );
  const monthlyStcEmployees = useMemo(
    () =>
      selectedDayStcRows.map((row) => ({
        employeeKey: row.employeeKey,
        id: row.id || row.employeeKey || '-',
        fullName: row.fullName || '-',
        department: row.department || '-',
        kind: row.kind || '-',
        status: 'STC',
        detail: firstStcDateMap.get(row.employeeKey)
          ? formatShortDateLabel(firstStcDateMap.get(row.employeeKey))
          : row.rawDisplay || row.display || 'STC',
      })),
    [firstStcDateMap, selectedDayStcRows],
  );
  const monthlyEffectifEmployees = useMemo(
    () =>
      selectedDayEffectifRows.map((row) => ({
        employeeKey: row.employeeKey,
        id: row.id || row.employeeKey || '-',
        fullName: row.fullName || '-',
        department: row.department || '-',
        kind: row.kind || '-',
        status: row.statusCode === 'STC' ? 'STC' : row.statusLabel || 'Actif',
        detail:
          row.statusCode === 'STC'
            ? firstStcDateMap.get(row.employeeKey)
              ? formatShortDateLabel(firstStcDateMap.get(row.employeeKey))
              : row.rawDisplay || row.display || 'STC'
            : row.statusCode === 'ABS' || row.statusCode === 'CM' || row.statusCode === 'CONGE'
              ? row.statusLabel || row.rawDisplay || row.display || '-'
              : row.rawDisplay || row.display || '-',
      })),
    [firstStcDateMap, selectedDayEffectifRows],
  );
  const presentRoster = useMemo(
    () => dayRoster.filter((row) => row.isPresent),
    [dayRoster],
  );
  const absenceRoster = useMemo(
    () => dayRoster.filter((row) => !row.isPresent && isTrackedAbsenceRow(row)),
    [dayRoster],
  );
  const kindComparison = useMemo(
    () => buildKindComparison(activeEmployees, presentRoster),
    [activeEmployees, presentRoster],
  );
  const departmentComparison = useMemo(
    () => buildDepartmentComparison(activeEmployees, presentRoster),
    [activeEmployees, presentRoster],
  );

  const departmentSegments = useMemo(() => getDepartmentSegments(selectedRows), [selectedRows]);
  const filteredWeekRows = useMemo(() => {
    const rows = Array.isArray(selectedWeek?.rows) ? selectedWeek.rows : [];
    return rows.filter((row) =>
      matchesSearch([row.id, row.fullName, row.department, row.kind], searchValue),
    );
  }, [searchValue, selectedWeek]);
  const departmentBaseRows = useMemo(() => buildDepartmentBaseRows(employees), [employees]);
  const filteredEmployeeBaseRows = useMemo(
    () =>
      employees.filter((employee) =>
        matchesSearch(
          [
            employee.finalCode,
            employee.id,
            employee.zk,
            employee.fullName,
            employee.department,
            employee.service,
            employee.contract,
            employee.status,
            employee.kind,
          ],
          searchValue,
        ),
      ),
    [employees, searchValue],
  );
  const filteredDepartmentBaseRows = useMemo(
    () =>
      departmentBaseRows.filter((department) =>
        matchesSearch(
          [
            department.label,
            department.total,
            department.active,
            department.stc,
            department.moi,
            department.mod,
            department.serviceCount,
          ],
          searchValue,
        ),
      ),
    [departmentBaseRows, searchValue],
  );
  const absenceSummary = useMemo(() => buildAbsenceSummary(absenceRoster), [absenceRoster]);
  const contractOptions = useMemo(
    () => [...new Set(employees.map((employee) => String(employee.contract || '').trim()).filter(Boolean))].sort(),
    [employees],
  );
  const departmentOptions = useMemo(
    () => [...new Set(employees.map((employee) => String(employee.department || '').trim()).filter(Boolean))].sort(),
    [employees],
  );
  const serviceOptions = useMemo(
    () => [...new Set(employees.map((employee) => String(employee.service || '').trim()).filter(Boolean))].sort(),
    [employees],
  );
  const filteredServiceOptions = useMemo(() => {
    const selectedDepartment = String(employeeDraft?.department || '').trim().toLowerCase();

    if (!selectedDepartment) {
      return serviceOptions;
    }

    const scopedServices = [
      ...new Set(
        employees
          .filter((employee) => String(employee.department || '').trim().toLowerCase() === selectedDepartment)
          .map((employee) => String(employee.service || '').trim())
          .filter(Boolean),
      ),
    ].sort();

    return scopedServices.length ? scopedServices : serviceOptions;
  }, [employeeDraft?.department, employees, serviceOptions]);
  const payTypeOptions = useMemo(
    () => [...new Set(employees.map((employee) => String(employee.payType || '').trim()).filter(Boolean))].sort(),
    [employees],
  );

  const totalEmployees = Number(selectedDayEffectifRows.length || 0);
  const presentEmployees = Number(selectedSummary?.presentEmployees || 0);
  const absentEmployees = useMemo(
    () => dayRoster.filter((row) => String(row.statusCode || '').toUpperCase() === 'ABS').length,
    [dayRoster],
  );
  const newEmployees = newRoster.length;
  const stcCount = monthlyStcEmployees.length;
  const attendanceRate = totalEmployees ? (presentEmployees / totalEmployees) * 100 : 0;
  const kpiDetailConfig = useMemo(
    () =>
      activeKpiModal
        ? buildKpiDetailConfig(activeKpiModal, {
            monthlyEffectifEmployees,
            presentRoster,
            absentRoster: absenceRoster,
            newRoster,
            stcEmployees: monthlyStcEmployees,
            selectedDate,
            periodLabel: activePeriodLabel,
            totalEmployees,
            presentEmployees,
            absentEmployees,
            newEmployees,
            stcCount,
          })
        : null,
    [
      activeKpiModal,
      monthlyEffectifEmployees,
      presentRoster,
      absenceRoster,
      newRoster,
      monthlyStcEmployees,
      selectedDate,
      activePeriodLabel,
      totalEmployees,
      presentEmployees,
      absentEmployees,
      newEmployees,
      stcCount,
    ],
  );
  const employeeBaseDetailConfig = useMemo(
    () =>
      activeEmployeeBaseModal
        ? buildEmployeeBaseDetailConfig(activeEmployeeBaseModal, {
            employees,
            activeEmployees,
            stcEmployees,
          })
        : null,
    [activeEmployeeBaseModal, activeEmployees, employees, stcEmployees],
  );

  const periodRange = availableDates.length
    ? `${formatShortDateLabel(availableDates[0])} au ${formatShortDateLabel(availableDates[availableDates.length - 1])}`
    : 'Aucune periode disponible';
  const latestImportLabel = formatDateTimeLabel(snapshot?.generatedAt);
  const isEmployeeSection = activeSection === 'employees';
  const isDepartmentSection = activeSection === 'departments';
  const isAbsenceSection = activeSection === 'absences';
  const baseServiceCount = useMemo(
    () =>
      new Set(
        employees
          .map((employee) => String(employee.service || '').trim())
          .filter(Boolean),
      ).size,
    [employees],
  );
  const tableTitle = isEmployeeSection
    ? 'BASE RH - EMPLOYES'
    : isDepartmentSection
      ? 'BASE RH - DEPARTEMENTS'
      : isAbsenceSection
        ? 'ABSENCES & CONGES'
      : `POINTAGE DU PERSONNEL - ${formatDateLabel(selectedDate)}`;
  const tableSubtitle = isEmployeeSection
    ? `${employees.length} fiche(s) chargee(s) depuis la base RH`
    : isDepartmentSection
      ? `${departmentBaseRows.length} departement(s) resumes depuis la base RH`
      : isAbsenceSection
        ? `${absenceRoster.length} absence(s) et conge(s) detecte(s) pour ${formatDateLabel(selectedDate)}`
      : `${selectedWeek?.title || 'Aucun tableau actif'}${selectedWeek?.weekId ? ` | ${selectedWeek.weekId}` : ''}`;
  const tableSearchPlaceholder = isEmployeeSection
    ? 'Rechercher un employe RH...'
    : isDepartmentSection
      ? 'Rechercher un departement...'
      : isAbsenceSection
        ? 'Rechercher une absence ou un conge...'
      : 'Rechercher...';

  function handleExportEmployeeBase() {
    exportEmployeeBaseWorkbook(employees, departmentBaseRows);
    setStatusMessage(`Export Excel de la base RH genere le 17/08/2026.`);
  }

  async function handleSaveEmployee() {
    if (!employeeDraft) {
      return;
    }

    try {
      setIsEmployeeSaving(true);
      const fallbackCode = getNextEmployeeCodeValue(employees);
      const fallbackZk = getNextZkValue(employees);
      const draftToSave =
        employeeEditorMode === 'create'
          ? {
              ...employeeDraft,
              id: String(employeeDraft.id || '').trim() || fallbackCode,
              finalCode: String(employeeDraft.finalCode || '').trim() || fallbackCode,
              saber: String(employeeDraft.saber || '').trim() || fallbackCode,
              zk: String(employeeDraft.zk || '').trim() || fallbackZk,
            }
          : employeeDraft;
      const result = await saveEmployeeRecord(draftToSave);
      setEmployees(() =>
        Array.isArray(result.employees) ? sortEmployeeRecords(result.employees) : [],
      );
      setStatusMessage(result.message || 'Fiche employe sauvegardee.');
      handleCloseEmployeeEditor();
    } catch (error) {
      setStatusMessage(error.message || 'Sauvegarde employe impossible.');
    } finally {
      setIsEmployeeSaving(false);
    }
  }

  async function handleDeleteEmployee() {
    if (!employeeDraft) {
      return;
    }

    try {
      setIsEmployeeDeleting(true);
      const result = await deleteEmployeeRecord(employeeDraft, employeeDraft.recordId);
      setEmployees(() =>
        Array.isArray(result.employees) ? sortEmployeeRecords(result.employees) : [],
      );
      setStatusMessage(result.message || 'Fiche employe supprimee.');
      handleCloseEmployeeEditor();
    } catch (error) {
      setStatusMessage(error.message || 'Suppression employe impossible.');
    } finally {
      setIsEmployeeDeleting(false);
    }
  }

  return (
    <main className={`rh-shell${sidebarOpen ? ' is-sidebar-open' : ''}`}>
      <div
        className={`rh-overlay${sidebarOpen ? ' is-visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden={sidebarOpen ? 'false' : 'true'}
      />

      <Sidebar
        activeSection={activeSection}
        onSelect={handleSelectSection}
        periodLabel={selectedWeek?.weekId || 'Aucune semaine'}
        periodRange={periodRange}
        latestImportLabel={latestImportLabel}
        sidebarOpen={sidebarOpen}
      />

      <section className="rh-main">
        <header className="rh-topbar">
          <button
            className={`rh-menu-button${sidebarOpen ? ' is-active' : ''}`}
            type="button"
            aria-label="Menu"
            onClick={() => setSidebarOpen((current) => !current)}
          >
            <span />
            <span />
            <span />
          </button>

          <div className="rh-topbar__actions">
            <label className="rh-topbar__date">
              <span>Date selectionnee</span>
              <select
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                disabled={!availableDates.length}
              >
                {availableDates.length ? null : <option value="">Aucune date</option>}
                {availableDates.map((date) => (
                  <option key={date} value={date}>
                    {formatShortDateLabel(date)}
                  </option>
                ))}
              </select>
            </label>

            <div className="rh-user-chip">
              <img className="rh-user-chip__avatar" src={rhManagerAvatarUrl} alt="RH Manager" />
              <div>
                <strong>RH Manager</strong>
                <span>MYC Beauty</span>
              </div>
            </div>
          </div>
        </header>

        <section className="rh-content">
          {isEmployeeSection ? null : (
            <>
              <div className="rh-hero">
            <div>
              <p className="rh-eyebrow">Pointage quotidien du personnel</p>
              <h1>TABLEAU DE BORD RH</h1>
              <p className="rh-subcopy">
                Dashboard alimente par le fichier Excel de pointage. Clique sur un bouton a gauche
                ou sur une carte pour ouvrir une vraie liste de suivi RH.
              </p>
            </div>

            <div className="rh-toolbar">
              <label className="rh-import-button">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleImportFile}
                  disabled={isImporting || isLoading}
                />
                {isImporting ? 'Import en cours...' : 'Importer Excel'}
              </label>

              <div className="rh-status-pill">{statusMessage}</div>
            </div>
              </div>

              <section className="rh-kpi-grid">
            <KpiCard
              tone="indigo"
              label="Effectif du mois"
              value={totalEmployees || 0}
              note={activePeriodLabel}
              isActive={activeKpiModal === 'total'}
              onClick={() => handleOpenKpiModal('total')}
            />
            <KpiCard
              tone="green"
              label="Presents"
              value={presentEmployees}
              note={formatPercent(attendanceRate)}
              isActive={activeKpiModal === 'present'}
              onClick={() => handleOpenKpiModal('present')}
            />
            <KpiCard
              tone="orange"
              label="Absents"
              value={absentEmployees}
              note={formatPercent(totalEmployees ? (absentEmployees / totalEmployees) * 100 : 0)}
              isActive={activeKpiModal === 'absent'}
              onClick={() => handleOpenKpiModal('absent')}
            />
            <KpiCard
              tone="slate"
              label="Nouveaux"
              value={newEmployees}
              note="Premier pointage du jour"
              isActive={activeKpiModal === 'new'}
              onClick={() => handleOpenKpiModal('new')}
            />
            <KpiCard
              tone="blue"
              label="STC du mois"
              value={stcCount}
              note={formatPercent(totalEmployees ? (stcCount / totalEmployees) * 100 : 0)}
              isActive={activeKpiModal === 'stc'}
              onClick={() => handleOpenKpiModal('stc')}
            />
              </section>

              <section className="rh-chart-grid">
            <article className="rh-card">
              <div className="rh-card__header">
                <h2>REPARTITION PAR DEPARTEMENT</h2>
              </div>

              <div className="rh-donut-layout">
                <div className="rh-donut" style={{ background: getDonutBackground(departmentSegments) }}>
                  <div className="rh-donut__center">
                    <strong>{presentEmployees}</strong>
                    <span>Total</span>
                  </div>
                </div>

                <div className="rh-legend">
                  {departmentSegments.length ? (
                    departmentSegments.map((segment) => (
                      <div className="rh-legend__item" key={segment.label}>
                        <span className="rh-legend__dot" style={{ backgroundColor: segment.color }} />
                        <strong>{segment.label}</strong>
                        <span>
                          {segment.count} ({segment.percent.toFixed(0)}%)
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="rh-empty-inline">Aucune presence pour cette date.</div>
                  )}
                </div>
              </div>
            </article>

            <article className="rh-card">
              <div className="rh-card__header">
                <h2>STATUT DU PERSONNEL</h2>
              </div>

              <div className="rh-bars">
                {[
                  { key: 'present', label: 'Presents', value: presentEmployees, tone: 'green' },
                  { key: 'absent', label: 'Absents', value: absentEmployees, tone: 'red' },
                  { key: 'new', label: 'Nouveaux', value: newEmployees, tone: 'slate' },
                  { key: 'stc', label: 'STC du mois', value: stcCount, tone: 'blue' },
                ].map((item) => (
                  <button
                    className={`rh-bars__item${activeKpiModal === item.key ? ' is-active' : ''}`}
                    key={item.label}
                    type="button"
                    onClick={() => handleOpenKpiModal(item.key)}
                    aria-label={`Ouvrir la liste ${item.label}`}
                  >
                    <div className="rh-bars__track">
                      <div
                        className={`rh-bars__fill rh-bars__fill--${item.tone}`}
                        style={{
                          height: `${Math.max(12, totalEmployees ? (item.value / totalEmployees) * 100 : 0)}%`,
                        }}
                      />
                    </div>
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                    <small>Clique pour ouvrir</small>
                  </button>
                ))}
              </div>
            </article>

            <article className="rh-card">
              <div className="rh-card__header">
                <h2>TAUX DE PRESENCE</h2>
              </div>

              <div className="rh-gauge">
                <div
                  className="rh-gauge__dial"
                  style={{
                    background: `conic-gradient(#14c784 0 ${attendanceRate}%, #edf1f7 ${attendanceRate}% 100%)`,
                  }}
                >
                  <div className="rh-gauge__center">
                    <strong>{formatPercent(attendanceRate)}</strong>
                    <span>Objectif : 90%</span>
                  </div>
                </div>
              </div>
            </article>
              </section>
            </>
          )}

          {isEmployeeSection || isDepartmentSection || isAbsenceSection ? (
            isEmployeeSection ? (
              <EmployeeBaseSurface
                employees={employees}
                filteredEmployees={filteredEmployeeBaseRows}
                departmentRows={departmentBaseRows}
                searchValue={searchValue}
                onSearchChange={setSearchValue}
                onCreate={handleOpenCreateEmployee}
                onEdit={handleOpenEditEmployee}
                onExport={handleExportEmployeeBase}
                onOpenAll={() => handleOpenEmployeeBaseModal('all')}
                onOpenActive={() => handleOpenEmployeeBaseModal('active')}
                onOpenStc={() => handleOpenEmployeeBaseModal('stc')}
                activeEmployeesCount={activeEmployees.length}
                stcEmployeesCount={stcEmployees.length}
                departmentCount={departmentBaseRows.length}
              />
            ) : isAbsenceSection ? (
              <AbsenceSurface
                selectedDate={selectedDate}
                rows={absenceRoster}
                summary={absenceSummary}
                searchValue={searchValue}
                onSearchChange={setSearchValue}
              />
            ) : (
              <article className="rh-card rh-card--base">
                <div className="rh-base-surface">
                  <div className="rh-base-surface__hero">
                    <div>
                      <p className="rh-eyebrow">Base RH enregistree</p>
                      <h2>{tableTitle}</h2>
                      <p>{tableSubtitle}</p>
                    </div>

                    <div className="rh-table-tools">
                      <input
                        type="search"
                        value={searchValue}
                        placeholder={tableSearchPlaceholder}
                        onChange={(event) => setSearchValue(event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="rh-base-metrics">
                    <article className="rh-base-metric">
                      <span>Departements</span>
                      <strong>{departmentBaseRows.length}</strong>
                    </article>
                    <article className="rh-base-metric">
                      <span>Services</span>
                      <strong>{baseServiceCount}</strong>
                    </article>
                    <article className="rh-base-metric">
                      <span>Actifs</span>
                      <strong>{activeEmployees.length}</strong>
                    </article>
                    <article className="rh-base-metric">
                      <span>STC</span>
                      <strong>{stcEmployees.length}</strong>
                    </article>
                  </div>

                  <div className="rh-table-wrap">
                    <table className="rh-table">
                      <thead>
                        <tr>
                          <th>Departement</th>
                          <th>Total base</th>
                          <th>Actifs</th>
                          <th>STC</th>
                          <th>MOI</th>
                          <th>MOD</th>
                          <th>Services</th>
                          <th>Taux actif</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDepartmentBaseRows.length ? (
                          filteredDepartmentBaseRows.map((department) => (
                            <tr key={department.label}>
                              <td>{department.label}</td>
                              <td>{department.total}</td>
                              <td>{department.active}</td>
                              <td>{department.stc}</td>
                              <td>{department.moi}</td>
                              <td>{department.mod}</td>
                              <td>{department.serviceCount}</td>
                              <td>{formatPercent(department.activeRate)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td className="rh-table__empty" colSpan={8}>
                              Aucun departement trouve pour cette recherche.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </article>
            )
          ) : (
            <article className="rh-card rh-card--table">
              <div className="rh-card__header rh-card__header--table">
                <div>
                  <h2>{tableTitle}</h2>
                  <p>{tableSubtitle}</p>
                </div>

                <div className="rh-table-tools">
                  <input
                    type="search"
                    value={searchValue}
                    placeholder={tableSearchPlaceholder}
                    onChange={(event) => setSearchValue(event.target.value)}
                  />
                </div>
              </div>

              <div className="rh-table-wrap">
                <table className="rh-table">
                  <thead>
                    <tr>
                      <th>ID ZK</th>
                      <th>Nom</th>
                      <th>Departement</th>
                      <th>Categorie</th>
                      {selectedWeek?.dayColumns?.map((day) => (
                        <th
                          key={day.isoDate || day.label}
                          className={day.isoDate === selectedDate ? 'is-selected' : ''}
                        >
                          {day.label}
                        </th>
                      ))}
                      <th>Heures standard</th>
                      <th>Controle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWeekRows.length ? (
                      filteredWeekRows.map((row) => (
                        <tr key={`${row.employeeKey}-${row.id}`}>
                          <td>{row.id || '-'}</td>
                          <td>{row.fullName || '-'}</td>
                          <td>{row.department || '-'}</td>
                          <td>{row.kind || '-'}</td>
                          {row.days.map((day, index) => (
                            <td
                              key={`${row.employeeKey}-${day.isoDate || index}`}
                              className={day.isoDate === selectedDate ? 'is-selected' : ''}
                            >
                              <span className={`rh-cell-badge rh-cell-badge--${String(day.status || '').toLowerCase()}`}>
                                {day.display || '-'}
                              </span>
                            </td>
                          ))}
                          <td>{row.totalHours || '-'}</td>
                          <td>{row.control || '-'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="rh-table__empty" colSpan={7 + (selectedWeek?.dayColumns?.length || 0)}>
                          Aucun employe a afficher. Importe un fichier Excel pour remplir le tableau.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          )}
        </section>
      </section>

      {kpiDetailConfig ? (
        <KpiDetailModal
          config={kpiDetailConfig}
          searchValue={kpiSearchValue}
          onSearchChange={setKpiSearchValue}
          onClose={handleCloseKpiModal}
        />
      ) : null}

      {employeeBaseDetailConfig ? (
        <KpiDetailModal
          config={employeeBaseDetailConfig}
          searchValue={kpiSearchValue}
          onSearchChange={setKpiSearchValue}
          onClose={handleCloseEmployeeBaseModal}
        />
      ) : null}

      {employeeEditorMode !== 'closed' ? (
        <EmployeeEditorModal
          mode={employeeEditorMode}
          draft={employeeDraft}
          deleteCode={deleteCode}
          isSaving={isEmployeeSaving}
          isDeleting={isEmployeeDeleting}
          contractOptions={contractOptions}
          departmentOptions={departmentOptions}
          serviceOptions={filteredServiceOptions}
          payTypeOptions={payTypeOptions}
          onChange={handleEmployeeDraftChange}
          onSave={handleSaveEmployee}
          onDelete={handleDeleteEmployee}
          onDeleteCodeChange={setDeleteCode}
          onClose={handleCloseEmployeeEditor}
        />
      ) : null}
    </main>
  );
}
