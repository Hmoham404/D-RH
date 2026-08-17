import {
  formatSupabaseError,
  getSupabaseConfigIssue,
  hasSupabaseEnv,
  supabase,
} from '../lib/supabase';

const TABLE_NAME = 'hr_dashboard_store';
const CURRENT_RECORD_ID = 'rh-pointage-analysis';
const HISTORY_RECORD_PREFIX = 'rh-pointage-history-';
function getSnapshotDates(snapshot) {
  const weeklyDates = Array.isArray(snapshot?.weeklySheets)
    ? snapshot.weeklySheets
        .flatMap((sheet) => sheet.dayColumns?.map((day) => day.isoDate) || [])
        .filter(Boolean)
    : [];
  const summaryDates = Array.isArray(snapshot?.dailySummaries)
    ? snapshot.dailySummaries.map((item) => item.isoDate).filter(Boolean)
    : [];

  return [...new Set([...weeklyDates, ...summaryDates])].sort();
}

function buildImportId(snapshot) {
  if (snapshot?.importId) {
    return String(snapshot.importId);
  }

  const generatedAt = snapshot?.generatedAt || new Date().toISOString();
  return generatedAt.replace(/[^0-9]/g, '').slice(0, 14) || `${Date.now()}`;
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }

  const trackedDates = getSnapshotDates(snapshot);
  const periodStart = trackedDates[0] || '';
  const periodEnd = trackedDates[trackedDates.length - 1] || '';
  const generatedAt = snapshot.generatedAt || new Date().toISOString();
  const importId = buildImportId({ ...snapshot, generatedAt });

  return {
    importId,
    fileName: snapshot.fileName || '',
    sheetCount: Number(snapshot.sheetCount || 0),
    sheetNames: Array.isArray(snapshot.sheetNames) ? snapshot.sheetNames : [],
    generatedAt,
    periodStart,
    periodEnd,
    summary: snapshot.summary && typeof snapshot.summary === 'object' ? snapshot.summary : {},
    rawRows: Array.isArray(snapshot.rawRows) ? snapshot.rawRows : [],
    dayRows: Array.isArray(snapshot.dayRows) ? snapshot.dayRows : [],
    dailySummaries: Array.isArray(snapshot.dailySummaries) ? snapshot.dailySummaries : [],
    sheetSummaries: Array.isArray(snapshot.sheetSummaries) ? snapshot.sheetSummaries : [],
    weeklySheets: Array.isArray(snapshot.weeklySheets) ? snapshot.weeklySheets : [],
    employeeRows: Array.isArray(snapshot.employeeRows) ? snapshot.employeeRows : [],
    kindCoverage: Array.isArray(snapshot.kindCoverage) ? snapshot.kindCoverage : [],
    departmentCoverage: Array.isArray(snapshot.departmentCoverage) ? snapshot.departmentCoverage : [],
  };
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

function upsertLocalHistoryEntry(snapshot) {
  const nextEntry = toHistoryEntry(snapshot);
  if (!nextEntry) return;

  const currentHistory = readLocalHistory().filter((entry) => entry.importId !== nextEntry.importId);
  writeLocalHistory([nextEntry, ...currentHistory]);
}

function clearLocalPointageSnapshot() {
}

function clearLocalPointageHistory() {
}

async function persistSnapshotRows(normalized, resetBeforeSave = false) {
  writeLocalSnapshot(normalized);
  upsertLocalHistoryEntry(normalized);
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      data: normalized,
      mode: 'local-disabled',
      message: `${configIssue || 'Supabase indisponible.'} Le pointage n est pas sauvegarde localement.`,
    };
  }

  const updatedAt = new Date().toISOString();

  try {
    if (resetBeforeSave) {
      const { error: currentDeleteError } = await supabase
        .from(TABLE_NAME)
        .delete()
        .eq('id', CURRENT_RECORD_ID);

      if (currentDeleteError) {
        return {
          data: normalized,
          mode: 'local-disabled',
          message: formatSupabaseError(currentDeleteError, 'Reset pointage'),
        };
      }

      const { error: historyDeleteError } = await supabase
        .from(TABLE_NAME)
        .delete()
        .like('id', `${HISTORY_RECORD_PREFIX}%`);

      if (historyDeleteError) {
        return {
          data: normalized,
          mode: 'local-disabled',
          message: formatSupabaseError(historyDeleteError, 'Reset historique pointage'),
        };
      }
    }

    const rows = [
      {
        id: CURRENT_RECORD_ID,
        payload: normalized,
        updated_at: updatedAt,
      },
      {
        id: `${HISTORY_RECORD_PREFIX}${normalized.importId}`,
        payload: normalized,
        updated_at: updatedAt,
      },
    ];

    const { error } = await supabase.from(TABLE_NAME).upsert(rows, { onConflict: 'id' });

    if (error) {
      return {
        data: normalized,
        mode: 'local-disabled',
        message: formatSupabaseError(error, 'Publication pointage'),
      };
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
    message: resetBeforeSave
      ? 'Base pointage videe puis nouveau fichier importe dans Supabase.'
      : 'Pointage importe, analyse et sauvegarde dans Supabase.',
  };
}

export async function loadPointageSnapshot() {
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
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('payload, updated_at')
      .eq('id', CURRENT_RECORD_ID)
      .maybeSingle();

    if (error) {
      return {
        data: null,
        mode: 'local-disabled',
        message: 'Connexion Supabase indisponible. Aucun snapshot pointage charge.',
      };
    }

    if (!data?.payload) {
      return {
        data: null,
        mode: 'remote-empty',
        message: 'Aucun snapshot pointage n a encore ete publie en ligne.',
      };
    }

    const normalized = normalizeSnapshot(data.payload);
    writeLocalSnapshot(normalized);
    upsertLocalHistoryEntry(normalized);

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

export async function savePointageSnapshot(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) {
    throw new Error('Snapshot pointage invalide.');
  }

  return persistSnapshotRows(normalized, false);
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
    const { error } = await supabase.from(TABLE_NAME).delete().eq('id', CURRENT_RECORD_ID);

    if (error) {
      return {
        mode: 'local-disabled',
        message: formatSupabaseError(error, 'Reset pointage'),
      };
    }
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
