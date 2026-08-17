import { useEffect, useMemo, useState } from 'react';
import { analyzePointageFile, exportPointageAnalysis } from '../lib/pointageImport';
import {
  clearPointageSnapshot,
  loadPointageHistory,
  loadPointageSnapshot,
  savePointageSnapshot,
} from '../services/pointageSnapshotStore';

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatDateTime(value) {
  if (!value) return '-';

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
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

function SummaryCard({ label, value, note }) {
  return (
    <article className="admin-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <p className="admin-pointage-card-note">{note}</p> : null}
    </article>
  );
}

function CoverageTable({ title, rows, emptyLabel }) {
  return (
    <article className="admin-table-card admin-table-card--compact">
      <div className="admin-table-card__header">
        <div>
          <p className="eyebrow">Couverture</p>
          <h3>{title}</h3>
        </div>
      </div>

      {rows.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table admin-table--compact">
            <thead>
              <tr>
                <th>Libelle</th>
                <th>Fichier</th>
                <th>Base active</th>
                <th>% couverture</th>
                <th>% dans fichier</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.fileCount}</td>
                  <td>{row.baseCount}</td>
                  <td>{formatPercent(row.coveragePercent)}</td>
                  <td>{formatPercent(row.sharePercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="op-lookup__empty">{emptyLabel}</div>
      )}
    </article>
  );
}

function PresenceTable({ title, eyebrow, rows, columns, emptyLabel }) {
  return (
    <article className="admin-table-card admin-table-card--compact">
      <div className="admin-table-card__header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
      </div>

      {rows.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table admin-table--compact">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={
                    row.id ||
                    row.employeeKey ||
                    `${row.isoDate || row.sheetName || 'row'}-${row.matchedName || index}`
                  }
                >
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.render ? column.render(row) : row[column.key] ?? '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="op-lookup__empty">{emptyLabel}</div>
      )}
    </article>
  );
}

export default function AdminPointageImportPanel({ employees, isLoading }) {
  const [analysis, setAnalysis] = useState(null);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [snapshotStatus, setSnapshotStatus] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(true);
  const [importError, setImportError] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [matchFilter, setMatchFilter] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  const filteredRows = useMemo(() => {
    if (!analysis) return [];

    const normalizedSearch = searchValue.trim().toLowerCase();

    return analysis.employeeRows.filter((row) => {
      const matchOk = !matchFilter || row.matchState === matchFilter;
      if (!matchOk) return false;

      if (!normalizedSearch) return true;

      return [
        row.sourceId,
        row.sourceName,
        row.matchedName,
        row.department,
        row.service,
        row.kind,
        row.statusLabel,
      ]
        .map((value) => String(value || '').toLowerCase())
        .some((value) => value.includes(normalizedSearch));
    });
  }, [analysis, matchFilter, searchValue]);

  const presentRows = useMemo(() => {
    if (!analysis || !selectedDate) return [];

    return analysis.dayRows
      .filter((row) => row.isoDate === selectedDate)
      .sort((left, right) => {
        const departmentSort = String(left.department || '').localeCompare(String(right.department || ''));
        if (departmentSort !== 0) return departmentSort;
        return String(left.matchedName || '').localeCompare(String(right.matchedName || ''));
      });
  }, [analysis, selectedDate]);

  const selectedDaySummary = useMemo(() => {
    if (!analysis || !selectedDate) return null;
    return analysis.dailySummaries.find((item) => item.isoDate === selectedDate) || null;
  }, [analysis, selectedDate]);

  const availableDates = useMemo(
    () =>
      Array.isArray(analysis?.weeklySheets)
        ? [...new Set(
            analysis.weeklySheets.flatMap((sheet) => sheet.dayColumns?.map((day) => day.isoDate) || []),
          )]
            .filter(Boolean)
            .sort()
        : [],
    [analysis],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrapSnapshot() {
      setIsLoadingSnapshot(true);
      const [snapshotResult, historyResult] = await Promise.all([
        loadPointageSnapshot(),
        loadPointageHistory(),
      ]);
      if (cancelled) return;

      setAnalysis(snapshotResult.data || null);
      setSnapshotStatus(snapshotResult.message);
      setHistoryEntries(historyResult.data || []);
      setHistoryStatus(historyResult.message);
      setSelectedDate(getLatestTrackedDate(snapshotResult.data));
      setIsLoadingSnapshot(false);
    }

    bootstrapSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFileImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);
      setImportError('');
      const nextAnalysis = await analyzePointageFile(file, employees);
      const saveResult = await savePointageSnapshot(nextAnalysis);
      const historyResult = await loadPointageHistory();
      setAnalysis(saveResult.data);
      setSelectedDate(getLatestTrackedDate(saveResult.data));
      setSnapshotStatus(saveResult.message);
      setHistoryEntries(historyResult.data || []);
      setHistoryStatus(historyResult.message);
    } catch (error) {
      setImportError(error.message || 'Import impossible.');
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  }

  async function handleResetData() {
    try {
      setIsResetting(true);
      setImportError('');
      const result = await clearPointageSnapshot();
      const historyResult = await loadPointageHistory();
      setAnalysis(null);
      setSelectedDate('');
      setSnapshotStatus(result.message);
      setHistoryEntries(historyResult.data || []);
      setHistoryStatus(historyResult.message);
    } catch (error) {
      setImportError(error.message || 'Reset impossible.');
    } finally {
      setIsResetting(false);
    }
  }

  function handleOpenHistoryEntry(entry) {
    if (!entry?.snapshot) return;

    setAnalysis(entry.snapshot);
    setSelectedDate(getLatestTrackedDate(entry.snapshot));
    setSnapshotStatus(
      `Import historique charge: ${entry.fileName || 'fichier'} (${entry.periodStart || '-'} au ${entry.periodEnd || '-'})`,
    );
  }

  function handleExport() {
    if (!analysis) return;
    exportPointageAnalysis(analysis);
  }

  return (
    <section className="admin-pointage-panel">
      <article className="admin-table-card">
        <div className="admin-table-card__header">
          <div>
            <p className="eyebrow">Pointage admin</p>
            <h3>Importer et controler le fichier pointage</h3>
          </div>
          <div className="admin-table-card__tools">
            <label className="field-block admin-file-input">
              <span>Fichier Excel pointage</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileImport}
                disabled={isImporting || isLoading}
              />
            </label>
            <button
              className="ghost-button ghost-button--small"
              type="button"
              onClick={handleExport}
              disabled={!analysis}
            >
              Exporter controle
            </button>
            <button
              className="danger-button danger-button--soft"
              type="button"
              onClick={handleResetData}
              disabled={isResetting || isImporting || isLoadingSnapshot}
            >
              {isResetting ? 'Reset...' : 'Reset data'}
            </button>
          </div>
        </div>

        <p className="admin-status-note">
          Importe chaque jour le classeur de pointage complet. Le systeme sauvegarde le dernier
          import en ligne, archive chaque fichier dans Supabase, suit les jours de presence,
          verifie les noms et codes employe, puis calcule les pourcentages <strong>MOD/MOI</strong>
          et par <strong>departement</strong>.
        </p>

        {isLoading ? (
          <div className="op-lookup__message">
            Chargement de la base employes avant activation du controle pointage...
          </div>
        ) : null}
        {isLoadingSnapshot ? (
          <div className="op-lookup__message">Chargement du dernier snapshot pointage en ligne...</div>
        ) : null}
        {isImporting ? <div className="op-lookup__message">Analyse du fichier en cours...</div> : null}
        {isResetting ? <div className="op-lookup__message">Suppression de la donnee courante...</div> : null}
        {importError ? <div className="error-note">{importError}</div> : null}
        {snapshotStatus ? <div className="admin-status-note">{snapshotStatus}</div> : null}
        {historyStatus ? <div className="admin-status-note">{historyStatus}</div> : null}

        {analysis ? (
          <>
            <div className="admin-pointage-meta">
              <span>
                <strong>Fichier:</strong> {analysis.fileName}
              </span>
              <span>
                <strong>Periode:</strong> {analysis.periodStart || '-'} au {analysis.periodEnd || '-'}
              </span>
              <span>
                <strong>Feuilles:</strong> {analysis.sheetCount}
              </span>
              <span>
                <strong>Jours suivis:</strong> {analysis.summary.trackedDays}
              </span>
              <span>
                <strong>Analyse:</strong> {formatDateTime(analysis.generatedAt)}
              </span>
            </div>

            <section className="admin-stats admin-stats--pointage">
              <SummaryCard
                label="Employes reconnus"
                value={analysis.summary.matchedEmployees}
                note={`${analysis.summary.activeMatchedEmployees} actifs couverts`}
              />
              <SummaryCard
                label="Introuvables"
                value={analysis.summary.unmatchedEmployees}
                note={`${analysis.summary.unmatchedRows} ligne(s) sans correspondance`}
              />
              <SummaryCard
                label="A verifier"
                value={analysis.summary.reviewEmployees}
                note={`${analysis.summary.oddDayCount} jour(s) impair(s)`}
              />
              <SummaryCard
                label="Couverture active"
                value={formatPercent(analysis.summary.activeCoveragePercent)}
                note={`${analysis.summary.activeMatchedEmployees} / ${analysis.summary.activeEmployeesTotal}`}
              />
            </section>

            <article className="admin-table-card admin-table-card--compact">
              <div className="admin-table-card__header">
                <div>
                  <p className="eyebrow">Dashboard</p>
                  <h3>Presence du jour importe</h3>
                </div>
                <div className="admin-table-card__tools">
                  <label className="field-block">
                    <span>Jour analyse</span>
                    <select
                      value={selectedDate}
                      onChange={(event) => setSelectedDate(event.target.value)}
                    >
                      {availableDates.map((isoDate) => (
                        <option key={isoDate} value={isoDate}>
                          {formatDateChoiceLabel(isoDate)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {selectedDaySummary ? (
                <section className="admin-stats admin-stats--pointage">
                  <SummaryCard
                    label="Presents"
                    value={selectedDaySummary.presentEmployees}
                    note="Employes detectes dans le fichier pour ce jour"
                  />
                  <SummaryCard
                    label="Reconnu(s)"
                    value={selectedDaySummary.matchedEmployees}
                    note="Employes relies a la base RH"
                  />
                  <SummaryCard
                    label="A verifier"
                    value={selectedDaySummary.reviewEmployees}
                    note={`${selectedDaySummary.oddEntries} ligne(s) impaire(s)`}
                  />
                  <SummaryCard
                    label="Heures"
                    value={selectedDaySummary.totalRoundedClock}
                    note={`${selectedDaySummary.punchCount} pointage(s) sur ${formatDateChoiceLabel(selectedDate)}`}
                  />
                </section>
              ) : (
                <div className="op-lookup__empty">Aucun jour de presence disponible.</div>
              )}
            </article>

            <article className="admin-table-card admin-table-card--compact">
              <div className="admin-table-card__header">
                <div>
                  <p className="eyebrow">Historique</p>
                  <h3>Imports journaliers sauvegardes</h3>
                </div>
              </div>

              <div className="admin-table-card__summary">
                <span>{historyEntries.length} import(s) archives</span>
                <span>Chaque nouveau fichier est garde dans Supabase et peut etre recharge pour controle.</span>
              </div>

              {historyEntries.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table--compact">
                    <thead>
                      <tr>
                        <th>Fichier</th>
                        <th>Periode</th>
                        <th>Analyse</th>
                        <th>Jours</th>
                        <th>Reconnu(s)</th>
                        <th>A verifier</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyEntries.map((entry) => (
                        <tr key={entry.importId}>
                          <td>{entry.fileName || '-'}</td>
                          <td>
                            {entry.periodStart || '-'} au {entry.periodEnd || '-'}
                          </td>
                          <td>{formatDateTime(entry.updatedAt || entry.generatedAt)}</td>
                          <td>{entry.trackedDays}</td>
                          <td>{entry.matchedEmployees}</td>
                          <td>{entry.reviewEmployees}</td>
                          <td>
                            <button
                              className="ghost-button ghost-button--small"
                              type="button"
                              onClick={() => handleOpenHistoryEntry(entry)}
                            >
                              Ouvrir
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="op-lookup__empty">
                  Aucun import archive pour le moment. Importe un fichier pour commencer le suivi.
                </div>
              )}
            </article>

            <section className="admin-pointage-grid">
              <PresenceTable
                title="Suivi par feuille"
                eyebrow="Classeur"
                rows={analysis.sheetSummaries}
                emptyLabel="Aucune feuille exploitable n a ete trouvee."
                columns={[
                  { key: 'sheetName', label: 'Feuille' },
                  { key: 'usableRows', label: 'Lignes' },
                  { key: 'trackedDays', label: 'Jours' },
                  { key: 'uniqueEmployees', label: 'Employes' },
                  { key: 'punchCount', label: 'Pointages' },
                ]}
              />
              <PresenceTable
                title="Suivi de presence par jour"
                eyebrow="Presence"
                rows={analysis.dailySummaries}
                emptyLabel="Aucun jour de presence n a ete calcule."
                columns={[
                  { key: 'isoDate', label: 'Date' },
                  { key: 'presentEmployees', label: 'Presents' },
                  { key: 'matchedEmployees', label: 'Reconnu(s)' },
                  { key: 'reviewEmployees', label: 'A verifier' },
                  { key: 'unmatchedEmployees', label: 'Introuvable(s)' },
                  { key: 'oddEntries', label: 'Impair(s)' },
                  { key: 'totalRoundedClock', label: 'Heures' },
                ]}
              />
            </section>

            <PresenceTable
              title="Personnes presentes"
              eyebrow="Presents"
              rows={presentRows}
              emptyLabel="Aucune personne presente pour la date selectionnee."
              columns={[
                { key: 'matchedName', label: 'Nom' },
                { key: 'department', label: 'Departement' },
                { key: 'service', label: 'Service' },
                { key: 'kind', label: 'Type' },
                { key: 'statusLabel', label: 'Controle' },
                { key: 'entry', label: 'Entree' },
                { key: 'exit', label: 'Sortie' },
                { key: 'roundedClock', label: 'Heures' },
              ]}
            />

            <section className="admin-pointage-grid">
              <CoverageTable
                title="Repartition MOD / MOI"
                rows={analysis.kindCoverage}
                emptyLabel="Aucune categorie n a ete reconnue dans ce fichier."
              />
              <CoverageTable
                title="Repartition par departement"
                rows={analysis.departmentCoverage}
                emptyLabel="Aucun departement n a ete reconnu dans ce fichier."
              />
            </section>

            <article className="admin-table-card admin-table-card--compact">
              <div className="admin-table-card__header">
                <div>
                  <p className="eyebrow">Controle nom par nom</p>
                  <h3>Employes trouves dans le fichier</h3>
                </div>
                <div className="admin-table-card__tools">
                  <label className="field-block admin-search">
                    <span>Recherche</span>
                    <input
                      type="search"
                      value={searchValue}
                      placeholder="Nom, code, departement..."
                      onChange={(event) => setSearchValue(event.target.value)}
                    />
                  </label>

                  <label className="field-block">
                    <span>Etat</span>
                    <select
                      value={matchFilter}
                      onChange={(event) => setMatchFilter(event.target.value)}
                    >
                      <option value="">Tous</option>
                      <option value="matched">Reconnu</option>
                      <option value="review">A verifier</option>
                      <option value="unmatched">Introuvable</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="admin-table-card__summary">
                <span>{filteredRows.length} employe(s) affiche(s)</span>
                <span>Controle par code, puis par nom complet normalise sur toutes les feuilles.</span>
              </div>

              {filteredRows.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Etat</th>
                        <th>ID source</th>
                        <th>Nom fichier</th>
                        <th>Nom base</th>
                        <th>Type</th>
                        <th>Departement</th>
                        <th>Service</th>
                        <th>Statut</th>
                        <th>Feuilles</th>
                        <th>Jours</th>
                        <th>Impairs</th>
                        <th>Heures</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row) => (
                        <tr key={row.employeeKey}>
                          <td>{row.statusLabel}</td>
                          <td>{row.sourceId || '-'}</td>
                          <td>{row.sourceName || '-'}</td>
                          <td>{row.matchedName || '-'}</td>
                          <td>{row.kind || '-'}</td>
                          <td>{row.department || '-'}</td>
                          <td>{row.service || '-'}</td>
                          <td>{row.employeeStatus || '-'}</td>
                          <td>{row.sheetCount}</td>
                          <td>{row.daysCount}</td>
                          <td>{row.oddDayCount}</td>
                          <td>{row.totalRoundedClock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="op-lookup__empty">
                  Aucun employe ne correspond au filtre de recherche.
                </div>
              )}
            </article>
          </>
        ) : (
          <>
            <div className="op-lookup__empty">
              Aucun fichier importe pour le moment. Utilise le champ ci-dessus pour charger
              `Paye_Pointage_31-07.xlsx` ou un autre classeur de presence.
            </div>

            <article className="admin-table-card admin-table-card--compact">
              <div className="admin-table-card__header">
                <div>
                  <p className="eyebrow">Historique</p>
                  <h3>Imports journaliers sauvegardes</h3>
                </div>
              </div>

              <div className="admin-table-card__summary">
                <span>{historyEntries.length} import(s) archives</span>
                <span>L archive reste disponible meme si la donnee courante a ete reset.</span>
              </div>

              {historyEntries.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table--compact">
                    <thead>
                      <tr>
                        <th>Fichier</th>
                        <th>Periode</th>
                        <th>Analyse</th>
                        <th>Jours</th>
                        <th>Reconnu(s)</th>
                        <th>A verifier</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyEntries.map((entry) => (
                        <tr key={entry.importId}>
                          <td>{entry.fileName || '-'}</td>
                          <td>
                            {entry.periodStart || '-'} au {entry.periodEnd || '-'}
                          </td>
                          <td>{formatDateTime(entry.updatedAt || entry.generatedAt)}</td>
                          <td>{entry.trackedDays}</td>
                          <td>{entry.matchedEmployees}</td>
                          <td>{entry.reviewEmployees}</td>
                          <td>
                            <button
                              className="ghost-button ghost-button--small"
                              type="button"
                              onClick={() => handleOpenHistoryEntry(entry)}
                            >
                              Ouvrir
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="op-lookup__empty">
                  Aucun import archive pour le moment. Importe un fichier pour commencer le suivi.
                </div>
              )}
            </article>
          </>
        )}
      </article>
    </section>
  );
}
