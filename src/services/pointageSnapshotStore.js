import {
  formatSupabaseError,
  getSupabaseConfigIssue,
  hasSupabaseEnv,
  supabase,
} from '../lib/supabase';
import { canonicalizePointageSnapshotDates } from '../lib/pointageSnapshotDates.js';
import { compactPointageStorage, expandPointageStorage } from '../lib/pointageStorage.js';
import { PAYROLL_RETENTION, emptyPayrollSnapshot } from '../lib/payrollPointage.js';
import { getPayrollPeriod } from '../lib/pointagePeriod.js';
import { getLocalPointageDate } from '../lib/pointageDates.js';

const TABLE_NAME = 'hr_dashboard_store';
const CURRENT_RECORD_ID = 'rh-pointage-analysis';
const HISTORY_RECORD_PREFIX = 'rh-pointage-history-';
const CORRECTION_RECORD_PREFIX = 'rh-pointage-correction-';

function pointageCorrectionRecordId(correction) {
  const correctedAt = Date.parse(correction.correctedAt || '') || Date.now();
  const nonce = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${CORRECTION_RECORD_PREFIX}${correction.isoDate}-${encodeURIComponent(String(correction.employeeKey))}-${correctedAt}-${nonce}`;
}

export async function savePointageCorrection(correction) {
  if (!hasSupabaseEnv || !supabase) {
    return { mode: 'local-disabled', message: `${getSupabaseConfigIssue() || 'Supabase indisponible.'} La correction n est pas sauvegardee.` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(correction?.isoDate || '') || !String(correction?.employeeKey || '')) {
    return { mode: 'local-disabled', message: 'Correction RH invalide.' };
  }
  try {
    // Each RH edit is one tiny append-only row, independent of the large import snapshot.
    const id = pointageCorrectionRecordId(correction);
    const { error } = await supabase.from(TABLE_NAME).insert({ id,
      payload: { kind: 'rh-pointage-correction-v1', employeeKey: correction.employeeKey,
        isoDate: correction.isoDate, correction }, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { mode: 'supabase', data: correction, corrections: [correction] };
  } catch (error) {
    return { mode: 'local-disabled', message: formatSupabaseError(error, 'Sauvegarde correction RH') };
  }
}
export async function clearPointageCorrectionsForDates(dates) {
  if (!hasSupabaseEnv || !supabase) return { mode: 'local-disabled', message: getSupabaseConfigIssue() || 'Supabase indisponible.' };
  const dateSet = new Set((dates || []).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)));
  if (!dateSet.size) return { mode: 'supabase' };
  try {
    const { data: rows, error: readError } = await supabase.from(TABLE_NAME).select('id')
      .like('id', `${CORRECTION_RECORD_PREFIX}%`);
    if (readError) throw readError;
    const ids = (rows || []).filter((row) => dateSet.has(row.id.slice(CORRECTION_RECORD_PREFIX.length, CORRECTION_RECORD_PREFIX.length + 10)))
      .map((row) => row.id);
    if (!ids.length) return { mode: 'supabase' };
    const { error } = await supabase.from(TABLE_NAME)
      .update({ payload: { cleared: true }, updated_at: new Date().toISOString() }).in('id', ids);
    if (error) throw error;
    return { mode: 'supabase' };
  } catch (error) {
    return { mode: 'local-disabled', message: formatSupabaseError(error, 'Nettoyage corrections RH') };
  }
}
function getSnapshotDates(snapshot) {
  const rawDates = Array.isArray(snapshot?.rawRows)
    ? snapshot.rawRows.map((row) => row.isoDate).filter(Boolean)
    : [];
  const weeklyDates = Array.isArray(snapshot?.weeklySheets)
    ? snapshot.weeklySheets
        .flatMap((sheet) => sheet.dayColumns?.map((day) => day.isoDate) || [])
        .filter(Boolean)
    : [];
  const summaryDates = Array.isArray(snapshot?.dailySummaries)
    ? snapshot.dailySummaries.map((item) => item.isoDate).filter(Boolean)
    : [];

  return [...new Set([...rawDates, ...weeklyDates, ...summaryDates])].sort();
}

// Compare the dates actually stored on the server, before any read-time repair.
// JSONB may reorder object keys, while array order and cell values stay intact.
function stableJson(value) {
  if (value && typeof value.toJSON === 'function') return stableJson(value.toJSON());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function snapshotDates(pointage) {
  if (!pointage) return null;
  pointage = expandPointageStorage(pointage);
  return {
    version: pointage.dateNormalizationVersion,
    contract: pointage.sourceDateContract,
    encoding: pointage.dateEncoding,
    dateRebuildRequired: Boolean(pointage.dateRebuildRequired),
    calculationRules: pointage.calculationRules,
    periodStart: pointage.periodStart,
    periodEnd: pointage.periodEnd,
    rawRows: pointage.rawRows || [],
    dayRows: pointage.dayRows || [],
    closedDates: pointage.closedDates,
    incomingDates: pointage.importDiagnostics?.incomingDates,
    dailySummaries: (pointage.dailySummaries || []).map((day) => day.isoDate),
    sourceWeeklySheets: (pointage.sourceWeeklySheets || []).map((sheet) => ({
      dayColumns: (sheet.dayColumns || []).map((day) => day.isoDate),
      rows: (sheet.rows || []).map((row) => (row.days || []).map((day) => day.isoDate)),
    })),
    weeklySheets: (pointage.weeklySheets || []).map((sheet) => ({
      dayColumns: (sheet.dayColumns || []).map((day) => day.isoDate),
    })),
    current: pointage.currentFilePointage ? snapshotDates(pointage.currentFilePointage) : null,
  };
}

function withStorageMetadata(snapshot, record) {
  if (!snapshot) return null;
  return {
    ...snapshot,
    storageRevision: record.updated_at || '',
    storageNeedsDateRepair: stableJson(snapshotDates(record.payload)) !== stableJson(snapshotDates(snapshot)),
  };
}

export function hasPointageDateChanges(previous, next) {
  return stableJson(snapshotDates(previous)) !== stableJson(snapshotDates(next));
}

function buildImportId(snapshot) {
  if (snapshot?.importId) {
    return String(snapshot.importId);
  }

  const generatedAt = snapshot?.generatedAt || new Date().toISOString();
  return generatedAt.replace(/[^0-9]/g, '').slice(0, 14) || `${Date.now()}`;
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.cleared) {
    return null;
  }

  snapshot = canonicalizePointageSnapshotDates(snapshot);
  const trackedDates = getSnapshotDates(snapshot);
  const periodStart = trackedDates[0] || '';
  const periodEnd = trackedDates[trackedDates.length - 1] || '';
  const generatedAt = snapshot.generatedAt || new Date().toISOString();
  const importId = buildImportId({ ...snapshot, generatedAt });

  const { storageRevision, storageNeedsDateRepair, ...persistedSnapshot } = snapshot;
  const normalized = {
    ...persistedSnapshot,
    importId,
    fileName: snapshot.fileName || '',
    sourceOnlyVersion: snapshot.sourceOnlyVersion || null,
    sourceWeeklySheets: Array.isArray(snapshot.sourceWeeklySheets) ? snapshot.sourceWeeklySheets : [],
    dateNormalizationVersion: snapshot.dateNormalizationVersion || null,
    sourceDateContract: snapshot.sourceDateContract || null,
    dateEncoding: snapshot.dateEncoding || null,
    payrollPeriodStart: snapshot.payrollPeriodStart || '',
    sheetCount: Number(snapshot.sheetCount || 0),
    sheetNames: Array.isArray(snapshot.sheetNames) ? snapshot.sheetNames : [],
    generatedAt,
    periodStart,
    periodEnd,
    summary: snapshot.summary && typeof snapshot.summary === 'object' ? snapshot.summary : {},
    rawRows: Array.isArray(snapshot.rawRows) ? snapshot.rawRows : [],
    closedDates: Array.isArray(snapshot.closedDates) ? snapshot.closedDates : [],
    calculationRules: snapshot.calculationRules || null,
    importDiagnostics: snapshot.importDiagnostics || null,
    currentFilePointage: snapshot.currentFilePointage || null,
    manualCorrections: Array.isArray(snapshot.manualCorrections) ? snapshot.manualCorrections : [],
    dayRows: Array.isArray(snapshot.dayRows) ? snapshot.dayRows : [],
    dailySummaries: Array.isArray(snapshot.dailySummaries) ? snapshot.dailySummaries : [],
    sheetSummaries: Array.isArray(snapshot.sheetSummaries) ? snapshot.sheetSummaries : [],
    weeklySheets: Array.isArray(snapshot.weeklySheets) ? snapshot.weeklySheets : [],
    employeeRows: Array.isArray(snapshot.employeeRows) ? snapshot.employeeRows : [],
    kindCoverage: Array.isArray(snapshot.kindCoverage) ? snapshot.kindCoverage : [],
    departmentCoverage: Array.isArray(snapshot.departmentCoverage) ? snapshot.departmentCoverage : [],
  };
  // Compare and return the same JSON representation that PostgREST stores,
  // including Date punches, undefined fields and nonfinite numeric cells.
  return JSON.parse(JSON.stringify(normalized));
}

function toHistoryEntry(snapshot, updatedAt = '') {
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) return null;

  return {
    importId: normalized.importId,
    fileName: normalized.fileName,
    generatedAt: normalized.generatedAt,
    updatedAt: updatedAt || normalized.generatedAt,
    periodStart: normalized.periodStart,
    periodEnd: normalized.periodEnd,
    trackedDays: Number(normalized.summary?.trackedDays || 0),
    matchedEmployees: Number(normalized.summary?.matchedEmployees || 0),
    reviewEmployees: Number(normalized.summary?.reviewEmployees || 0),
    unmatchedEmployees: Number(normalized.summary?.unmatchedEmployees || 0),
    snapshot: normalized,
  };
}

function readLocalSnapshot() {
  return null;
}

function writeLocalSnapshot(snapshot) {
  void snapshot;
}

function readLocalHistory() {
  return [];
}

function writeLocalHistory(entries) {
  void entries;
}

function clearLocalPointageSnapshot() {
}

function clearLocalPointageHistory() {
}

async function clearStoredPointageRecords(filter) {
  await filter(supabase.from(TABLE_NAME).delete());
  const { data: remaining, error: readError } = await filter(supabase.from(TABLE_NAME).select('id'));
  if (readError) throw readError;
  if (!remaining?.length) return;

  // Some installations allow UPDATE but have no DELETE policy. Erase the payload there.
  const { error: clearError } = await filter(supabase.from(TABLE_NAME)
    .update({ payload: { cleared: true }, updated_at: new Date().toISOString() }));
  if (clearError) throw clearError;
  const { data: verified, error: verifyError } = await filter(supabase.from(TABLE_NAME)
    .select('id,cleared:payload->>cleared'));
  if (verifyError) throw verifyError;
  if (verified.some((row) => String(row.cleared) !== 'true')) {
    throw new Error('Le serveur n a pas efface les anciennes donnees de pointage.');
  }
}

async function persistSnapshotRows(normalized, resetBeforeSave = false, options = {}) {
  if (normalized.retentionPolicy === PAYROLL_RETENTION && normalized.payrollPeriodStart !== getPayrollPeriod().start) {
    return { data: null, mode: 'conflict', message: 'Le mois de paie a changÃ©. Rechargez la page avant de sauvegarder.' };
  }
  writeLocalSnapshot(normalized);
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      data: normalized,
      mode: 'local-disabled',
      message: `${configIssue || 'Supabase indisponible.'} Le pointage n est pas sauvegarde localement.`,
    };
  }

  const updatedAt = new Date().toISOString();
  let historyResetError = '';
  let historySaveError = '';

  try {

    const payload = compactPointageStorage(normalized);
    const rows = [
      {
        id: CURRENT_RECORD_ID,
        payload,
        updated_at: updatedAt,
      },
      {
        id: `${HISTORY_RECORD_PREFIX}${normalized.importId}`,
        payload,
        updated_at: updatedAt,
      },
    ];

    // Do not upsert two full snapshots in one statement. PostgreSQL runs both
    // INSERT and UPDATE guards on an upsert conflict, multiplying validation
    // and JSON processing, increasing the risk of statement_timeout.
    let revision = options.expectedUpdatedAt;
    if (!Object.prototype.hasOwnProperty.call(options, 'expectedUpdatedAt')) {
      const current = await supabase.from(TABLE_NAME).select('updated_at')
        .eq('id', CURRENT_RECORD_ID).maybeSingle();
      if (current.error) throw current.error;
      revision = current.data?.updated_at || null;
    } else if (revision === undefined || revision === '') {
      throw new Error('Recalcul annule : la revision du pointage sauvegarde est inconnue. Recharge la page.');
    }

    let error;
    if (revision) {
      const result = await supabase.from(TABLE_NAME)
        .update({ payload, updated_at: updatedAt })
        .eq('id', CURRENT_RECORD_ID)
        .eq('updated_at', revision)
        .select('updated_at');
      error = result.error;
      if (!error && !result.data?.length) {
        return {
          data: null,
          mode: 'conflict',
          message: 'Le pointage a change sur le serveur. Le recalcul ancien a ete annule. Recharge la page.',
        };
      }
    } else {
      ({ error } = await supabase.from(TABLE_NAME).insert(rows[0]));
      if (error?.code === '23505') {
        return { data: null, mode: 'conflict',
          message: 'Le pointage a change sur le serveur. Recharge la page avant de reimporter le fichier.' };
      }
    }

    if (error) {
      return {
        data: normalized,
        mode: 'local-disabled',
        message: formatSupabaseError(error, 'Publication pointage'),
      };
    }
    const { data: stored, error: readError } = await supabase.from(TABLE_NAME)
      .select('payload, updated_at').eq('id', CURRENT_RECORD_ID).maybeSingle();
    if (readError) throw readError;
    if (!stored?.payload || stored.payload.importId !== normalized.importId
      || stored.payload.generatedAt !== normalized.generatedAt
      || stableJson(snapshotDates(stored.payload)) !== stableJson(snapshotDates(normalized))) {
      return {
        data: null,
        mode: 'conflict',
        message: 'La verification de la sauvegarde a echoue : les dates relues depuis Supabase different du fichier. Recharge la page.',
      };
    }
    normalized = withStorageMetadata(normalizeSnapshot(stored.payload), stored);
    // The current snapshot is already saved and verified. An archive timeout
    // must not report that the import itself was lost or erase older history.
    try {
      if (normalized.retentionPolicy !== PAYROLL_RETENTION) {
      let historyResult = await supabase.from(TABLE_NAME)
        .update({ payload: rows[1].payload, updated_at: updatedAt })
        .eq('id', rows[1].id).select('id');
      if (historyResult.error) throw historyResult.error;
      if (!historyResult.data?.length) {
        historyResult = await supabase.from(TABLE_NAME).insert(rows[1]);
        if (historyResult.error) throw historyResult.error;
      }
      }
    } catch (error) {
      historySaveError = formatSupabaseError(error, 'Copie historique');
    }
    // Publish the replacement before removing history, keeping the old data if publication fails.
    if (resetBeforeSave && !historySaveError && normalized.retentionPolicy !== PAYROLL_RETENTION) {
      try {
        await clearStoredPointageRecords((query) => query
          .like('id', `${HISTORY_RECORD_PREFIX}%`)
          .neq('id', `${HISTORY_RECORD_PREFIX}${normalized.importId}`));
      } catch (error) {
        historyResetError = formatSupabaseError(error, 'Suppression de l ancien historique');
      }
    }
  } catch (error) {
    return {
      data: normalized,
      mode: 'local-disabled',
      message: formatSupabaseError(error, 'Publication pointage'),
    };
  }

  return {
    data: normalized,
    mode: 'supabase',
    historySaveFailed: Boolean(historySaveError),
    historyResetFailed: Boolean(historyResetError),
    message: historySaveError
      ? `Pointage sauvegarde et verifie dans Supabase. ${historySaveError}. L ancien historique est conserve.`
      : resetBeforeSave
      ? historyResetError
        ? `Nouveau pointage enregistre. ${historyResetError}`
        : 'Le nouveau fichier remplace le pointage precedent. Ancien historique supprime.'
      : 'Pointage importe, analyse et sauvegarde dans Supabase.',
  };
}

let pendingSnapshotLoad = null;

export function loadPointageSnapshot() {
  if (!pendingSnapshotLoad) {
    pendingSnapshotLoad = fetchPointageSnapshot().finally(() => { pendingSnapshotLoad = null; });
  }
  return pendingSnapshotLoad;
}

async function fetchPointageSnapshot() {
  const localSnapshot = readLocalSnapshot();
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      data: null,
      mode: 'local-disabled',
      message: configIssue || 'Supabase indisponible. Aucune copie locale du pointage n est conservee.',
    };
  }

  try {
    // Corrections and source snapshot are independent reads. Start them in the
    // same network round trip rather than waiting for the large JSON first.
    const [{ data, error }, correctionsResult] = await Promise.all([
      supabase.from(TABLE_NAME).select('payload, updated_at')
        .eq('id', CURRENT_RECORD_ID).maybeSingle(),
      supabase.from(TABLE_NAME).select('payload').like('id', `${CORRECTION_RECORD_PREFIX}%`),
    ]);

    if (error) {
      return {
        data: null,
        mode: 'local-disabled',
        message: 'Connexion Supabase indisponible. Aucun snapshot pointage charge.',
      };
    }

    if (!data?.payload || data.payload.cleared) {
      return {
        data: null,
        mode: 'remote-empty',
        message: 'Aucun snapshot pointage n a encore ete publie en ligne.',
      };
    }

    if (data.payload.retentionPolicy === PAYROLL_RETENTION
      && data.payload.payrollPeriodStart !== getPayrollPeriod().start) {
      const empty = emptyPayrollSnapshot(undefined, data.payload.calculationRules);
      const result = await savePointageSnapshot(empty, { expectedUpdatedAt: data.updated_at });
      if (result.mode !== 'supabase') return result;
      return { ...result, message: 'Nouveau mois de paie : le pointage prÃ©cÃ©dent a Ã©tÃ© vidÃ©.' };
    }
    let normalized = withStorageMetadata(normalizeSnapshot(data.payload), data);
    const { data: correctionRows, error: correctionsError } = correctionsResult;
    if (correctionsError) throw correctionsError;
    const periodStart = getPayrollPeriod().start;
    const today = getLocalPointageDate();
    const savedCorrections = (correctionRows || []).flatMap((row) => row.payload?.cleared ? []
      : row.payload?.correction ? [row.payload.correction] : row.payload?.corrections || [])
      .filter((item) => item?.isoDate >= periodStart && item?.isoDate <= today);
    const correctionKey = (item) => `${item.employeeKey}|${item.isoDate}|${item.correctedAt || JSON.stringify(item.after || {})}`;
    const allCorrections = [...(normalized.manualCorrections || []), ...(normalized.currentFilePointage?.manualCorrections || []), ...savedCorrections]
      .filter((item) => item?.isoDate >= periodStart && item?.isoDate <= today)
      .sort((a, b) => String(a.correctedAt || '').localeCompare(String(b.correctedAt || '')));
    const uniqueCorrections = [...new Map(allCorrections.map((item) => [correctionKey(item), item])).values()];
    normalized = { ...normalized, manualCorrections: uniqueCorrections,
      currentFilePointage: normalized.currentFilePointage
        ? { ...normalized.currentFilePointage, manualCorrections: uniqueCorrections }
        : normalized.currentFilePointage };
    writeLocalSnapshot(normalized);

    return {
      data: normalized,
      mode: 'supabase',
      message: data.updated_at
        ? `Dernier import en ligne: ${new Date(data.updated_at).toLocaleString()}`
        : 'Pointage charge depuis Supabase.',
    };
  } catch {
    return {
      data: null,
      mode: 'local-disabled',
      message: 'Connexion Supabase indisponible. Aucun snapshot pointage charge.',
    };
  }
}

export async function loadPointageHistory(limit = 15) {
  const localHistory = readLocalHistory().slice(0, limit);
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      data: [],
      mode: 'local-disabled',
      message: configIssue || 'Supabase indisponible. Aucun historique pointage local n est conserve.',
    };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('id, payload, updated_at')
      .like('id', `${HISTORY_RECORD_PREFIX}%`)
      .or('payload->>cleared.is.null,payload->>cleared.eq.false')
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      return {
        data: [],
        mode: 'local-disabled',
        message: 'Connexion Supabase indisponible. Aucun historique pointage charge.',
      };
    }

    const historyEntries = (data || [])
      .map((row) => toHistoryEntry(row.payload, row.updated_at))
      .filter(Boolean);

    if (historyEntries.length) {
      writeLocalHistory(historyEntries);
    }

    return {
      data: historyEntries.length ? historyEntries : localHistory,
      mode: historyEntries.length ? 'supabase' : 'remote-empty',
      message: historyEntries.length
        ? 'Historique pointage charge depuis Supabase.'
        : 'Aucun import historique n a encore ete sauvegarde.',
    };
  } catch {
    return {
      data: [],
      mode: 'local-disabled',
      message: 'Connexion Supabase indisponible. Aucun historique pointage charge.',
    };
  }
}

export async function savePointageSnapshot(snapshot, options = {}) {
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) {
    throw new Error('Snapshot pointage invalide.');
  }

  return persistSnapshotRows(normalized, false, options);
}

export async function replacePointageSnapshot(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) {
    throw new Error('Snapshot pointage invalide.');
  }

  return persistSnapshotRows(normalized, true);
}

export async function clearPointageSnapshot() {
  clearLocalPointageSnapshot();
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      mode: 'local-disabled',
      message: `${configIssue || 'Supabase indisponible.'} Aucune copie locale du pointage n existe.`,
    };
  }

  try {
    await clearStoredPointageRecords((query) => query.eq('id', CURRENT_RECORD_ID));
  } catch (error) {
    return {
      mode: 'local-disabled',
      message: formatSupabaseError(error, 'Reset pointage'),
    };
  }

  return {
    mode: 'supabase',
    message: 'Donnee pointage courante supprimee. L historique journalier reste conserve.',
  };
}

export function clearPointageHistoryLocalOnly() {
  clearLocalPointageHistory();
}
