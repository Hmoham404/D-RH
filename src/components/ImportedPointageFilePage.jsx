import { useEffect, useMemo, useState } from 'react';
import { loadPointageSnapshot } from '../services/pointageSnapshotStore';

function formatDateTime(value) {
  if (!value) return '-';

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function getWeeklyCellClass(status) {
  if (status === 'POINTAGE') return 'pointage-badge pointage-badge--ok';
  if (status === 'AVR') return 'pointage-badge pointage-badge--warn';
  return 'pointage-badge';
}

function getWeeklyCellLabel(cell) {
  return cell?.display || '-';
}

function formatDateChoiceLabel(isoDate) {
  if (!isoDate) return '-';

  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;

  const dayLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(date);
  const shortDate = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  }).format(date);

  return `${dayLabel} ${shortDate}`;
}

function getLatestTrackedDate(snapshot) {
  const dates = Array.isArray(snapshot?.weeklySheets)
    ? snapshot.weeklySheets
        .flatMap((sheet) => sheet.dayColumns?.map((day) => day.isoDate) || [])
        .filter(Boolean)
        .sort()
    : [];

  return dates[dates.length - 1] || '';
}

export default function ImportedPointageFilePage({ onNavigateHome, onNavigateAdmin, onNavigateLegacy }) {
  const [snapshot, setSnapshot] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function bootstrapSnapshot() {
      setIsLoading(true);
      const result = await loadPointageSnapshot();
      if (cancelled) return;

      setSnapshot(result.data || null);
      setStatusMessage(result.message);
      setSelectedDate(getLatestTrackedDate(result.data));
      setIsLoading(false);
    }

    bootstrapSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);

  const weeklySheets = useMemo(
    () => (Array.isArray(snapshot?.weeklySheets) ? snapshot.weeklySheets : []),
    [snapshot],
  );

  const availableDates = useMemo(
    () =>
      Array.isArray(snapshot?.weeklySheets)
        ? [...new Set(
            snapshot.weeklySheets.flatMap((sheet) => sheet.dayColumns?.map((day) => day.isoDate) || []),
          )]
            .filter(Boolean)
            .sort()
        : [],
    [snapshot],
  );

  const selectedDateIndex = useMemo(
    () => availableDates.findIndex((date) => date === selectedDate),
    [availableDates, selectedDate],
  );

  const orderedWeeklySheets = useMemo(() => {
    if (!selectedDate) return weeklySheets;

    return [...weeklySheets].sort((left, right) => {
      const leftHasDate = left.dayColumns.some((day) => day.isoDate === selectedDate);
      const rightHasDate = right.dayColumns.some((day) => day.isoDate === selectedDate);

      if (leftHasDate === rightHasDate) {
        return left.sheetName.localeCompare(right.sheetName);
      }

      return leftHasDate ? -1 : 1;
    });
  }, [selectedDate, weeklySheets]);

  const selectedDaySummary = useMemo(() => {
    if (!snapshot || !selectedDate) return null;
    return snapshot.dailySummaries.find((item) => item.isoDate === selectedDate) || null;
  }, [snapshot, selectedDate]);

  const presentRows = useMemo(() => {
    if (!snapshot || !selectedDate) return [];

    return snapshot.dayRows
      .filter((row) => row.isoDate === selectedDate)
      .sort((left, right) => {
        const departmentSort = String(left.department || '').localeCompare(String(right.department || ''));
        if (departmentSort !== 0) return departmentSort;
        return String(left.matchedName || '').localeCompare(String(right.matchedName || ''));
      });
  }, [snapshot, selectedDate]);

  function changeSelectedDate(nextDate) {
    if (!availableDates.includes(nextDate)) {
      return;
    }

    setSelectedDate(nextDate);
  }

  if (isLoading) {
    return (
      <section className="pointage-page">
        <article className="pointage-section">
          <div className="section-heading">
            <p className="eyebrow">Pointage fichier</p>
            <h3>Chargement du dernier fichier</h3>
          </div>
          <p className="admin-status-note">
            La page prepare le dernier snapshot de pointage importe depuis le fichier Excel.
          </p>
        </article>
      </section>
    );
  }

  if (!snapshot || !weeklySheets.length) {
    return (
      <section className="pointage-page">
        <article className="pointage-section">
          <div className="section-heading">
            <p className="eyebrow">Pointage fichier</p>
            <h3>Aucun fichier importe</h3>
          </div>
          <p className="admin-status-note">
            {statusMessage || 'Importe un fichier depuis /admin pour afficher cette page.'}
          </p>
          <div className="pointage-hero__actions">
            <button className="primary-button" type="button" onClick={onNavigateAdmin}>
              Ouvrir admin
            </button>
            <button className="ghost-button" type="button" onClick={onNavigateHome}>
              Retour home
            </button>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="pointage-page">
      <article className="pointage-hero">
        <div>
          <p className="eyebrow">Pointage fichier</p>
          <h2>Classeur paie importe</h2>
          <p>
            Cette page affiche le pointage du dernier fichier Excel importe, semaine par semaine,
            avec les feuilles <strong>S1, S2, S3...</strong>, leurs jours et leurs valeurs telles
            qu elles existent dans le classeur.
          </p>
        </div>

        <div className="pointage-hero__actions">
          <button className="primary-button" type="button" onClick={onNavigateAdmin}>
            Ouvrir admin
          </button>
          <button className="ghost-button" type="button" onClick={onNavigateLegacy}>
            Voir /pointage
          </button>
          <button className="ghost-button" type="button" onClick={onNavigateHome}>
            Retour home
          </button>
        </div>
      </article>

      <section className="pointage-stats">
        <article className="admin-stat-card">
          <span>Fichier</span>
          <strong>{snapshot.fileName || '-'}</strong>
        </article>
        <article className="admin-stat-card">
          <span>Semaines</span>
          <strong>{weeklySheets.length}</strong>
        </article>
        <article className="admin-stat-card">
          <span>Jours suivis</span>
          <strong>{snapshot.summary?.trackedDays || 0}</strong>
        </article>
        <article className="admin-stat-card">
          <span>Analyse</span>
          <strong>{formatDateTime(snapshot.generatedAt)}</strong>
        </article>
      </section>

      <article className="admin-table-card admin-table-card--compact">
        <div className="admin-table-card__header">
          <div>
            <p className="eyebrow">Jour</p>
            <h3>Presence du jour</h3>
          </div>
          <div className="admin-table-card__tools">
            <div className="pointage-date-controls">
              <div className="pointage-date-controls__nav">
                <button
                  className="ghost-button ghost-button--small"
                  type="button"
                  onClick={() => changeSelectedDate(availableDates[selectedDateIndex - 1])}
                  disabled={selectedDateIndex <= 0}
                >
                  Jour precedent
                </button>
                <button
                  className="ghost-button ghost-button--small"
                  type="button"
                  onClick={() => changeSelectedDate(availableDates[selectedDateIndex + 1])}
                  disabled={selectedDateIndex < 0 || selectedDateIndex >= availableDates.length - 1}
                >
                  Jour suivant
                </button>
              </div>

              <label className="field-block">
                <span>Date importee</span>
                <input
                  type="date"
                  value={selectedDate}
                  min={availableDates[0] || undefined}
                  max={availableDates[availableDates.length - 1] || undefined}
                  onChange={(event) => changeSelectedDate(event.target.value)}
                />
              </label>
            </div>
          </div>
        </div>

        {availableDates.length ? (
          <div className="pointage-date-strip" aria-label="Dates disponibles">
            {availableDates.map((date) => (
              <button
                key={date}
                className={`pointage-date-pill${date === selectedDate ? ' is-selected' : ''}`}
                type="button"
                onClick={() => changeSelectedDate(date)}
                title={date}
              >
                {formatDateChoiceLabel(date)}
              </button>
            ))}
          </div>
        ) : null}

        {selectedDaySummary ? (
          <section className="admin-stats admin-stats--pointage">
            <article className="admin-stat-card">
              <span>Presents</span>
              <strong>{selectedDaySummary.presentEmployees}</strong>
            </article>
            <article className="admin-stat-card">
              <span>Reconnu(s)</span>
              <strong>{selectedDaySummary.matchedEmployees}</strong>
            </article>
            <article className="admin-stat-card">
              <span>A verifier</span>
              <strong>{selectedDaySummary.reviewEmployees}</strong>
            </article>
            <article className="admin-stat-card">
              <span>Heures</span>
              <strong>{selectedDaySummary.totalRoundedClock}</strong>
            </article>
          </section>
        ) : (
          <div className="op-lookup__empty">Aucune date disponible dans ce fichier.</div>
        )}
      </article>

      {presentRows.length ? (
        <article className="pointage-section">
          <div className="pointage-section__header">
            <div className="section-heading">
              <p className="eyebrow">Presents</p>
              <h3>{selectedDate}</h3>
            </div>
          </div>

          <div className="pointage-table-wrap">
            <table className="pointage-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Departement</th>
                  <th>Service</th>
                  <th>Type</th>
                  <th>Controle</th>
                  <th>Entree</th>
                  <th>Sortie</th>
                  <th>Heures</th>
                </tr>
              </thead>
              <tbody>
                {presentRows.map((row) => (
                  <tr key={`${row.employeeKey}-${row.isoDate}`}>
                    <td>{row.matchedName || '-'}</td>
                    <td>{row.department || '-'}</td>
                    <td>{row.service || '-'}</td>
                    <td>{row.kind || '-'}</td>
                    <td>{row.statusLabel || '-'}</td>
                    <td>{row.entry || '-'}</td>
                    <td>{row.exit || '-'}</td>
                    <td>{row.roundedClock || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {orderedWeeklySheets.map((week) => (
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
                  className={day.isoDate === selectedDate ? 'is-selected' : ''}
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
                      className={day.isoDate === selectedDate ? 'is-selected' : ''}
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
                        className={day.isoDate === selectedDate ? 'is-selected' : ''}
                      >
                        <span className={getWeeklyCellClass(day.status)}>{getWeeklyCellLabel(day)}</span>
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
