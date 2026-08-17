import { useEffect, useMemo, useState } from 'react';
import employeesDirectory from '../employees.json';
import {
  clearPointageSnapshot,
  loadPointageHistory,
  loadPointageSnapshot,
} from '../services/pointageSnapshotStore';

const STATUS_OPTIONS = [
  { value: 'POINTAGE', label: 'Pointage' },
  { value: 'ABS', label: 'ABS' },
  { value: 'CONGE', label: 'Conge' },
  { value: 'MALADIE_CM', label: 'Maladie CM' },
  { value: 'SANS_SOLDE', label: 'Sans solde' },
  { value: 'CSS', label: 'CSS' },
];

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function normalizeCode(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const normalized = String(value).trim();
  if (!normalized) return '';

  if (/^\d+$/.test(normalized)) {
    return String(Number(normalized));
  }

  return normalized.toUpperCase();
}

function normalizeName(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[.\-_\/]/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .sort()
    .join('|');
}

function parseIsoDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDayLabel(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) return isoDate;

  return `${DAY_LABELS[date.getDay()]} ${String(date.getDate()).padStart(2, '0')}/${String(
    date.getMonth() + 1,
  ).padStart(2, '0')}`;
}

function formatDateChoiceLabel(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) return isoDate;

  const dayLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(date);
  const shortDate = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  }).format(date);

  return `${dayLabel} ${shortDate}`;
}

function formatDateTime(value) {
  if (!value) return '-';

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function getWeekStartIso(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) return isoDate;

  const mondayBasedOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayBasedOffset);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatWeekLabel(weekDays) {
  if (!weekDays.length) return '';

  const first = parseIsoDate(weekDays[0]);
  const last = parseIsoDate(weekDays[weekDays.length - 1]);
  if (!first || !last) return weekDays.join(' / ');

  const firstLabel = `${String(first.getDate()).padStart(2, '0')}/${String(first.getMonth() + 1).padStart(2, '0')}`;
  const lastLabel = `${String(last.getDate()).padStart(2, '0')}/${String(last.getMonth() + 1).padStart(2, '0')}`;
  return `${firstLabel} au ${lastLabel}`;
}

function buildEmployeeIndex() {
  const byCode = new Map();
  const byName = new Map();

  employeesDirectory.forEach((employee) => {
    const codes = [
      normalizeCode(employee.id),
      normalizeCode(employee.zk),
      normalizeCode(employee.finalCode),
      normalizeCode(employee.saber),
    ].filter(Boolean);

    codes.forEach((code) => {
      if (!byCode.has(code)) {
        byCode.set(code, employee);
      }
    });

    const nameKey = normalizeName(employee.fullName);
    if (nameKey && !byName.has(nameKey)) {
      byName.set(nameKey, employee);
    }
  });

  return { byCode, byName };
}

function buildEmployeeKey(employee) {
  return (
    normalizeCode(employee.zk) ||
    normalizeCode(employee.id) ||
    normalizeCode(employee.finalCode) ||
    normalizeName(employee.fullName)
  );
}

function getPrimaryMonth(days) {
  const monthCounts = new Map();

  days.forEach((isoDate) => {
    const monthKey = isoDate.slice(0, 7);
    monthCounts.set(monthKey, (monthCounts.get(monthKey) || 0) + 1);
  });

  return [...monthCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || '';
}

function buildWeeklyRows(report) {
  const dailyControls = report?.dailyControls || [];
  const days = dailyControls.map((day) => day.isoDate).sort();
  const primaryMonth = getPrimaryMonth(days);
  const selectedDays = dailyControls
    .filter((day) => day.isoDate.startsWith(primaryMonth))
    .sort((left, right) => left.isoDate.localeCompare(right.isoDate));

  const { byCode, byName } = buildEmployeeIndex();
  const employeeMap = new Map();

  employeesDirectory
    .filter((employee) => String(employee.status || '').toLowerCase() === 'actif')
    .forEach((employee) => {
      const employeeKey = buildEmployeeKey(employee);
      if (!employeeKey || employeeMap.has(employeeKey)) return;

      employeeMap.set(employeeKey, {
        employeeKey,
        zk: employee.zk || employee.id || '',
        fullName: employee.fullName || '',
        department: employee.department || '',
        service: employee.service || '',
        kind: employee.kind || '',
        status: employee.status || '',
        days: {},
      });
    });

  selectedDays.forEach((day) => {
    day.rows.forEach((row) => {
      const codeKey = normalizeCode(row.sourceId);
      const nameKey = normalizeName(row.matchedName || row.sourceName);
      const employee = byCode.get(codeKey) || byName.get(nameKey);
      const employeeKey = employee ? buildEmployeeKey(employee) : codeKey || nameKey;

      if (!employeeMap.has(employeeKey)) {
        return;
      }

      employeeMap.get(employeeKey).days[day.isoDate] = row;
    });
  });

  const employeeRows = [...employeeMap.values()].sort((left, right) =>
    `${left.department} ${left.fullName}`.localeCompare(`${right.department} ${right.fullName}`),
  );

  const weeksMap = new Map();
  selectedDays.forEach((day) => {
    const weekKey = getWeekStartIso(day.isoDate);
    if (!weeksMap.has(weekKey)) {
      weeksMap.set(weekKey, []);
    }
    weeksMap.get(weekKey).push(day.isoDate);
  });

  const weeks = [...weeksMap.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([weekKey, weekDays], index) => ({
      id: `S${index + 1}`,
      weekKey,
      weekLabel: formatWeekLabel(weekDays),
      days: weekDays.sort(),
    }));

  return {
    primaryMonth,
    selectedDays,
    employeeRows,
    weeks,
  };
}

function getDefaultCellStatus(cell) {
  if (!cell) return 'ABS';
  if (cell.state === 'OK' && cell.entry && cell.exit) return 'POINTAGE';
  return 'ABS';
}

function getStatusLabel(value) {
  return STATUS_OPTIONS.find((option) => option.value === value)?.label || value;
}

function getWeeklyTotalMinutes(week, employeeRow, overrides) {
  return week.days.reduce((total, isoDate) => {
    const cell = employeeRow.days[isoDate];
    const overrideKey = `${employeeRow.employeeKey}|${isoDate}`;
    const status = overrides[overrideKey] || getDefaultCellStatus(cell);

    if (status !== 'POINTAGE') {
      return total;
    }

    const roundedMinutes = Number(cell?.roundedMinutes || 0);
    return total + (Number.isFinite(roundedMinutes) ? roundedMinutes : 0);
  }, 0);
}

function formatMinutes(minutes) {
  const safeMinutes = Number(minutes || 0);
  const hours = Math.floor(safeMinutes / 60);
  const remaining = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function PointageCell({ cell, value, onChange }) {
  const isPointage = value === 'POINTAGE' && cell;

  return (
    <div className="weekly-pointage-cell">
      {isPointage ? (
        <div className="weekly-pointage-cell__times">
          <strong>
            {cell.entry?.slice(-5) || '--:--'} / {cell.exit?.slice(-5) || '--:--'}
          </strong>
          <span>{cell.roundedClock || '--:--'}</span>
        </div>
      ) : (
        <div className="weekly-pointage-cell__status">
          <strong>{getStatusLabel(value)}</strong>
          <span>
            {cell?.entry
              ? `${cell.entry.slice(-5)} / ${cell.exit?.slice(-5) || '--:--'}`
              : 'Sans pointage'}
          </span>
        </div>
      )}

      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function getWeeklyCellClass(status) {
  if (status === 'POINTAGE') return 'pointage-badge pointage-badge--ok';
  if (status === 'AVR') return 'pointage-badge pointage-badge--warn';
  return 'pointage-badge';
}

function getWeeklyCellLabel(cell) {
  if (!cell?.display) return '-';
  return cell.display;
}

function getImportedAvailableDates(snapshot) {
  if (!Array.isArray(snapshot?.weeklySheets)) {
    return [];
  }

  return [
    ...new Set(
      snapshot.weeklySheets.flatMap((sheet) => sheet.dayColumns?.map((day) => day.isoDate) || []),
    ),
  ]
    .filter(Boolean)
    .sort();
}

function formatImportPeriod(snapshot) {
  if (!snapshot) return '-';

  const start = snapshot.periodStart || '';
  const end = snapshot.periodEnd || '';

  if (!start && !end) {
    return '-';
  }

  return `${start || '-'} au ${end || '-'}`;
}

function PointageSavedImportActions({
  importOptions,
  selectedImportId,
  onSelectImport,
  onOpenImport,
  onResetData,
  onNavigateAdmin,
  snapshotStatus,
  historyStatus,
  isResetting,
}) {
  return (
    <article className="admin-table-card admin-table-card--compact">
      <div className="admin-table-card__header">
        <div>
          <p className="eyebrow">Pointage sauvegarde</p>
          <h3>Ouvrir le fichier enregistre dans la base</h3>
        </div>
        <div className="admin-table-card__tools">
          <label className="field-block">
            <span>Fichier sauvegarde</span>
            <select value={selectedImportId} onChange={(event) => onSelectImport(event.target.value)}>
              <option value="">Choisir un fichier</option>
              {importOptions.map((entry) => (
                <option key={entry.importId} value={entry.importId}>
                  {(entry.snapshot?.fileName || entry.fileName || 'Import')} - {formatImportPeriod(entry.snapshot || entry)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button"
            type="button"
            onClick={onOpenImport}
            disabled={!selectedImportId}
          >
            Ouvrir pointage
          </button>
          <button
            className="danger-button danger-button--soft"
            type="button"
            onClick={onResetData}
            disabled={isResetting}
          >
            {isResetting ? 'Reset...' : 'Reset data'}
          </button>
          <button className="primary-button" type="button" onClick={onNavigateAdmin}>
            Importer fichier dans /base
          </button>
          <button className="ghost-button ghost-button--small" type="button" onClick={onNavigateAdmin}>
            Aller vers /base
          </button>
        </div>
      </div>

      <p className="admin-status-note">
        Cette page reste vide tant que tu n ouvres pas un fichier sauvegarde. Pour importer un
        nouveau pointage Excel, va dans <strong>/base</strong>, puis reviens ici pour l ouvrir.
      </p>

      {!importOptions.length ? (
        <div className="op-lookup__empty">
          Aucun fichier de pointage sauvegarde dans la base pour le moment.
        </div>
      ) : null}
      {snapshotStatus ? <div className="admin-status-note">{snapshotStatus}</div> : null}
      {historyStatus ? <div className="admin-status-note">{historyStatus}</div> : null}
    </article>
  );
}

export default function PointageReportPage({
  report,
  onNavigateHome,
  onNavigateAdmin,
  onNavigateFile,
}) {
  const [overrides, setOverrides] = useState({});
  const [currentSnapshot, setCurrentSnapshot] = useState(null);
  const [onlineSnapshot, setOnlineSnapshot] = useState(null);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const [snapshotStatus, setSnapshotStatus] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');
  const [selectedImportId, setSelectedImportId] = useState('');
  const [selectedImportedDate, setSelectedImportedDate] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function bootstrapPointageSnapshot() {
      const [snapshotResult, historyResult] = await Promise.all([
        loadPointageSnapshot(),
        loadPointageHistory(),
      ]);
      if (cancelled) return;

      const history = historyResult.data || [];
      const initialSnapshot = snapshotResult.data || history[0]?.snapshot || null;

      setCurrentSnapshot(snapshotResult.data || initialSnapshot);
      setOnlineSnapshot(null);
      setHistoryEntries(history);
      setSnapshotStatus(snapshotResult.message || '');
      setHistoryStatus(historyResult.message || '');
      setSelectedImportId(initialSnapshot?.importId || history[0]?.importId || '');
      setSelectedImportedDate('');
      setIsLoadingSnapshot(false);
    }

    bootstrapPointageSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);

  const weeklyData = useMemo(() => buildWeeklyRows(report), [report]);
  const importedWeeklySheets = useMemo(
    () => (Array.isArray(onlineSnapshot?.weeklySheets) ? onlineSnapshot.weeklySheets : []),
    [onlineSnapshot],
  );
  const importedAvailableDates = useMemo(
    () => getImportedAvailableDates(onlineSnapshot),
    [onlineSnapshot],
  );
  const selectedImportedDateIndex = useMemo(
    () => importedAvailableDates.findIndex((date) => date === selectedImportedDate),
    [importedAvailableDates, selectedImportedDate],
  );
  const selectedImportedWeek = useMemo(
    () =>
      importedWeeklySheets.find((week) =>
        week.dayColumns.some((day) => day.isoDate === selectedImportedDate),
      ) || null,
    [importedWeeklySheets, selectedImportedDate],
  );
  const displayedImportedWeeks = useMemo(() => {
    if (selectedImportedWeek) {
      return [selectedImportedWeek];
    }

    return importedWeeklySheets.slice(0, 1);
  }, [importedWeeklySheets, selectedImportedWeek]);
  const selectedImportedDaySummary = useMemo(
    () =>
      onlineSnapshot?.dailySummaries?.find((item) => item.isoDate === selectedImportedDate) || null,
    [onlineSnapshot, selectedImportedDate],
  );
  const selectedImportEntry = useMemo(
    () => historyEntries.find((entry) => entry.importId === selectedImportId) || null,
    [historyEntries, selectedImportId],
  );
  const importOptions = useMemo(() => {
    const entries = historyEntries.length
      ? historyEntries
      : currentSnapshot
        ? [
            {
              importId: currentSnapshot.importId,
              fileName: currentSnapshot.fileName,
              updatedAt: currentSnapshot.generatedAt,
              snapshot: currentSnapshot,
            },
          ]
        : [];

    const uniqueEntries = new Map();
    entries.forEach((entry) => {
      if (!entry?.importId || uniqueEntries.has(entry.importId)) return;
      uniqueEntries.set(entry.importId, entry);
    });

    return [...uniqueEntries.values()];
  }, [currentSnapshot, historyEntries]);

  useEffect(() => {
    if (!importedAvailableDates.length) {
      if (selectedImportedDate) {
        setSelectedImportedDate('');
      }
      return;
    }

    if (!selectedImportedDate || !importedAvailableDates.includes(selectedImportedDate)) {
      setSelectedImportedDate(importedAvailableDates[importedAvailableDates.length - 1]);
    }
  }, [importedAvailableDates, selectedImportedDate]);

  const summary = useMemo(() => {
    let pointageCount = 0;
    let absenceCount = 0;

    weeklyData.weeks.forEach((week) => {
      weeklyData.employeeRows.forEach((employeeRow) => {
        week.days.forEach((isoDate) => {
          const cell = employeeRow.days[isoDate];
          const key = `${employeeRow.employeeKey}|${isoDate}`;
          const status = overrides[key] || getDefaultCellStatus(cell);

          if (status === 'POINTAGE') {
            pointageCount += 1;
          } else {
            absenceCount += 1;
          }
        });
      });
    });

    return {
      pointageCount,
      absenceCount,
    };
  }, [overrides, weeklyData]);

  function updateCellStatus(employeeKey, isoDate, value) {
    setOverrides((current) => ({
      ...current,
      [`${employeeKey}|${isoDate}`]: value,
    }));
  }

  function resetOverrides() {
    setOverrides({});
  }

  function handleOpenSavedImport() {
    if (!selectedImportId) {
      setSnapshotStatus('Choisis un fichier sauvegarde avant de l ouvrir.');
      return;
    }

    const historyMatch = historyEntries.find((entry) => entry.importId === selectedImportId);
    const selectedSnapshot =
      historyMatch?.snapshot ||
      (currentSnapshot?.importId === selectedImportId ? currentSnapshot : null);

    if (!selectedSnapshot) {
      setSnapshotStatus('Le fichier sauvegarde selectionne est introuvable.');
      return;
    }

    setOnlineSnapshot(selectedSnapshot);
    setSelectedImportedDate(getImportedAvailableDates(selectedSnapshot).slice(-1)[0] || '');
    setSnapshotStatus(
      `Pointage ouvert depuis la base: ${selectedSnapshot.fileName || 'fichier'} (${formatImportPeriod(selectedSnapshot)})`,
    );
  }

  async function handleResetData() {
    try {
      setIsResetting(true);
      const result = await clearPointageSnapshot();
      const [snapshotResult, historyResult] = await Promise.all([
        loadPointageSnapshot(),
        loadPointageHistory(),
      ]);
      const history = historyResult.data || [];
      const nextCurrentSnapshot = snapshotResult.data || null;

      setCurrentSnapshot(nextCurrentSnapshot);
      setOnlineSnapshot(null);
      setHistoryEntries(history);
      setSnapshotStatus(result.message || snapshotResult.message || '');
      setHistoryStatus(historyResult.message || '');
      setSelectedImportId(nextCurrentSnapshot?.importId || history[0]?.importId || '');
      setSelectedImportedDate('');
    } catch (error) {
      setSnapshotStatus(error.message || 'Reset impossible.');
    } finally {
      setIsResetting(false);
    }
  }

  if (isLoadingSnapshot) {
    return (
      <section className="pointage-page">
        <article className="pointage-section">
          <div className="section-heading">
            <p className="eyebrow">Pointage</p>
            <h3>Chargement du dernier import</h3>
          </div>
          <p className="admin-status-note">
            La page charge le dernier fichier de pointage importe avant d afficher les semaines.
          </p>
        </article>
      </section>
    );
  }

  if (importedWeeklySheets.length) {
    return (
      <section className="pointage-page">
        <article className="pointage-hero">
          <div>
            <p className="eyebrow">Pointage paie</p>
            <h2>Semaines importees depuis le fichier Excel</h2>
            <p>
              Cette vue reprend directement les feuilles <strong>S1, S2, S3...</strong> du
              fichier importe choisi, avec les dates et les valeurs de la paie.
            </p>
          </div>

          <div className="pointage-hero__actions">
            <button className="primary-button" type="button" onClick={onNavigateAdmin}>
              Ouvrir admin
            </button>
            {onNavigateFile ? (
              <button className="ghost-button" type="button" onClick={onNavigateFile}>
                Voir fichier importe
              </button>
            ) : null}
            <button className="ghost-button" type="button" onClick={onNavigateHome}>
              Retour home
            </button>
          </div>
        </article>

        <section className="pointage-stats">
          <article className="admin-stat-card">
            <span>Fichier</span>
            <strong>{onlineSnapshot?.fileName || '-'}</strong>
          </article>
          <article className="admin-stat-card">
            <span>Periode</span>
            <strong>{formatImportPeriod(onlineSnapshot)}</strong>
          </article>
          <article className="admin-stat-card">
            <span>Jours suivis</span>
            <strong>{onlineSnapshot?.summary?.trackedDays || 0}</strong>
          </article>
          <article className="admin-stat-card">
            <span>Employes reconnus</span>
            <strong>{onlineSnapshot?.summary?.matchedEmployees || 0}</strong>
          </article>
        </section>

        <PointageSavedImportActions
          importOptions={importOptions}
          selectedImportId={selectedImportId}
          onSelectImport={setSelectedImportId}
          onOpenImport={handleOpenSavedImport}
          onResetData={handleResetData}
          onNavigateAdmin={onNavigateAdmin}
          snapshotStatus={snapshotStatus}
          historyStatus={historyStatus}
          isResetting={isResetting}
        />

        <article className="admin-table-card admin-table-card--compact">
          <div className="admin-table-card__header">
            <div>
              <p className="eyebrow">Choix import + jour</p>
              <h3>Afficher la semaine selon le fichier et la date</h3>
            </div>
            <div className="admin-table-card__tools">
              <div className="pointage-date-controls">
                <label className="field-block">
                  <span>Import sauvegarde</span>
                  <select
                    value={selectedImportId}
                    onChange={(event) => setSelectedImportId(event.target.value)}
                  >
                    {importOptions.map((entry) => (
                      <option key={entry.importId} value={entry.importId}>
                        {(entry.snapshot?.fileName || entry.fileName || 'Import')}{' '}
                        - {formatImportPeriod(entry.snapshot || entry)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="pointage-date-controls__nav">
                  <button
                    className="ghost-button ghost-button--small"
                    type="button"
                    onClick={() =>
                      setSelectedImportedDate(
                        importedAvailableDates[selectedImportedDateIndex - 1] || '',
                      )
                    }
                    disabled={selectedImportedDateIndex <= 0}
                  >
                    Jour precedent
                  </button>
                  <button
                    className="ghost-button ghost-button--small"
                    type="button"
                    onClick={() =>
                      setSelectedImportedDate(
                        importedAvailableDates[selectedImportedDateIndex + 1] || '',
                      )
                    }
                    disabled={
                      selectedImportedDateIndex < 0 ||
                      selectedImportedDateIndex >= importedAvailableDates.length - 1
                    }
                  >
                    Jour suivant
                  </button>
                </div>

                <label className="field-block">
                  <span>Date importee</span>
                  <input
                    type="date"
                    value={selectedImportedDate}
                    min={importedAvailableDates[0] || undefined}
                    max={importedAvailableDates[importedAvailableDates.length - 1] || undefined}
                    onChange={(event) => {
                      if (importedAvailableDates.includes(event.target.value)) {
                        setSelectedImportedDate(event.target.value);
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          </div>

          {importedAvailableDates.length ? (
            <div className="pointage-date-strip" aria-label="Dates disponibles du pointage">
              {importedAvailableDates.map((date) => (
                <button
                  key={date}
                  className={`pointage-date-pill${date === selectedImportedDate ? ' is-selected' : ''}`}
                  type="button"
                  onClick={() => setSelectedImportedDate(date)}
                  title={date}
                >
                  {formatDateChoiceLabel(date)}
                </button>
              ))}
            </div>
          ) : null}

          {selectedImportedDaySummary ? (
            <section className="admin-stats admin-stats--pointage">
              <article className="admin-stat-card">
                <span>Import choisi</span>
                <strong>{selectedImportEntry?.fileName || onlineSnapshot?.fileName || '-'}</strong>
              </article>
              <article className="admin-stat-card">
                <span>Date choisie</span>
                <strong>{formatDateChoiceLabel(selectedImportedDate)}</strong>
              </article>
              <article className="admin-stat-card">
                <span>Semaine</span>
                <strong>{selectedImportedWeek?.weekId || '-'}</strong>
              </article>
              <article className="admin-stat-card">
                <span>Presents</span>
                <strong>{selectedImportedDaySummary.presentEmployees}</strong>
              </article>
              <article className="admin-stat-card">
                <span>Heures</span>
                <strong>{selectedImportedDaySummary.totalRoundedClock}</strong>
              </article>
            </section>
          ) : null}
        </article>

        {displayedImportedWeeks.map((week) => (
          <article className="pointage-section" key={week.sheetName}>
            <div className="pointage-section__header">
              <div className="section-heading">
                <p className="eyebrow">{week.weekId}</p>
                <h3>{week.title}</h3>
              </div>

              <div className="pointage-day-summary">
                {week.dayColumns.map((day) => (
                  <span
                    key={`${week.sheetName}-${day.isoDate || day.label}`}
                    className={day.isoDate === selectedImportedDate ? 'is-selected' : ''}
                  >
                    {day.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="pointage-table-wrap">
              <table className="pointage-table pointage-table--weekly">
                <thead>
                  <tr>
                    <th>ID ZK</th>
                    <th>Nom</th>
                    <th>Departement</th>
                    <th>Categorie</th>
                    {week.dayColumns.map((day) => (
                      <th
                        key={`${week.sheetName}-head-${day.isoDate || day.label}`}
                        className={day.isoDate === selectedImportedDate ? 'is-selected' : ''}
                      >
                        {day.label}
                      </th>
                    ))}
                    <th>Controle</th>
                  </tr>
                </thead>
                <tbody>
                  {week.rows.map((employeeRow) => (
                    <tr key={`${week.sheetName}-${employeeRow.employeeKey}`}>
                      <td>{employeeRow.id || '-'}</td>
                      <td>{employeeRow.fullName || '-'}</td>
                      <td>{employeeRow.department || '-'}</td>
                      <td>{employeeRow.kind || '-'}</td>
                      {employeeRow.days.map((day, index) => (
                        <td
                          key={`${employeeRow.employeeKey}-${day.isoDate || index}`}
                          className={day.isoDate === selectedImportedDate ? 'is-selected' : ''}
                        >
                          <span className={getWeeklyCellClass(day.status)}>
                            {getWeeklyCellLabel(day)}
                          </span>
                        </td>
                      ))}
                      <td>{employeeRow.control || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </section>
    );
  }

  if (!report) {
    return (
      <section className="pointage-page">
        <PointageSavedImportActions
          importOptions={importOptions}
          selectedImportId={selectedImportId}
          onSelectImport={setSelectedImportId}
          onOpenImport={handleOpenSavedImport}
          onResetData={handleResetData}
          onNavigateAdmin={onNavigateAdmin}
          snapshotStatus={snapshotStatus}
          historyStatus={historyStatus}
          isResetting={isResetting}
        />
      </section>
    );
  }

  return (
    <section className="pointage-page">
      <article className="pointage-hero">
        <div>
          <p className="eyebrow">Pointage paie</p>
          <h2>Entree, sortie et ecarts par semaine</h2>
          <p>
            Cette vue affiche le mois principal du fichier <strong>{weeklyData.primaryMonth}</strong>.
            Si une case est vide, elle est mise en <strong>ABS</strong> par defaut et tu peux la
            changer en <strong>Conge</strong>, <strong>Maladie CM</strong>, <strong>Sans solde</strong>{' '}
            ou <strong>CSS</strong>.
          </p>
        </div>

        <div className="pointage-hero__actions">
          <button className="primary-button" type="button" onClick={onNavigateAdmin}>
            Ouvrir admin
          </button>
          {onNavigateFile ? (
            <button className="ghost-button" type="button" onClick={onNavigateFile}>
              Voir fichier importe
            </button>
          ) : null}
          <button className="ghost-button" type="button" onClick={resetOverrides}>
            Reinitialiser codes
          </button>
          <button className="ghost-button" type="button" onClick={onNavigateHome}>
            Retour home
          </button>
        </div>
      </article>

      <PointageSavedImportActions
        importOptions={importOptions}
        selectedImportId={selectedImportId}
        onSelectImport={setSelectedImportId}
        onOpenImport={handleOpenSavedImport}
        onResetData={handleResetData}
        onNavigateAdmin={onNavigateAdmin}
        snapshotStatus={snapshotStatus}
        historyStatus={historyStatus}
        isResetting={isResetting}
      />

      <section className="pointage-empty-space" aria-hidden="true" />
    </section>
  );
}
