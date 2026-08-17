import { defaultHrData } from '../defaultHrData';
import {
  formatSupabaseError,
  getSupabaseConfigIssue,
  hasSupabaseEnv,
  supabase,
} from '../lib/supabase';

const TABLE_NAME = 'hr_dashboard_store';
const RECORD_ID = 'rh-homepage';
function normalizePayload(payload) {
  return {
    ...defaultHrData,
    ...payload,
    totals: {
      ...defaultHrData.totals,
      ...(payload?.totals ?? {}),
    },
    activeMix: {
      ...defaultHrData.activeMix,
      ...(payload?.activeMix ?? {}),
    },
    alerts: Array.isArray(payload?.alerts) ? payload.alerts : defaultHrData.alerts,
    activeDepartments: Array.isArray(payload?.activeDepartments)
      ? payload.activeDepartments
      : defaultHrData.activeDepartments,
    activeServices: Array.isArray(payload?.activeServices)
      ? payload.activeServices
      : defaultHrData.activeServices,
    contracts: Array.isArray(payload?.contracts) ? payload.contracts : defaultHrData.contracts,
    payTypes: Array.isArray(payload?.payTypes) ? payload.payTypes : defaultHrData.payTypes,
    recentHires: Array.isArray(payload?.recentHires)
      ? payload.recentHires
      : defaultHrData.recentHires,
  };
}

function readLocalDashboard() {
  return null;
}

function writeLocalDashboard(payload) {
  void payload;
}

export async function loadDashboardData() {
  const localDashboard = readLocalDashboard();
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      data: defaultHrData,
      mode: 'local-disabled',
      message: configIssue || 'Mode local desactive. Ajoute les cles Supabase dans .env pour synchroniser.',
    };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('payload, updated_at')
      .eq('id', RECORD_ID)
      .maybeSingle();

    if (error) {
      return {
        data: defaultHrData,
        mode: 'local-disabled',
        message: 'Connexion Supabase indisponible. Aucun cache local du dashboard n est utilise.',
      };
    }

    if (!data?.payload) {
      return {
        data: defaultHrData,
        mode: 'remote-empty',
        message: 'Table connectee, mais aucun snapshot n existe encore. Sauvegarde pour initialiser.',
      };
    }

    const normalized = normalizePayload(data.payload);
    writeLocalDashboard(normalized);

    return {
      data: normalized,
      mode: 'supabase',
      message: data.updated_at
        ? `Derniere sauvegarde distante: ${new Date(data.updated_at).toLocaleString()}`
        : 'Donnees chargees depuis Supabase.',
    };
  } catch (error) {
    return {
      data: defaultHrData,
      mode: 'local-disabled',
      message: 'Connexion Supabase indisponible. Aucun cache local du dashboard n est utilise.',
    };
  }
}

export async function saveDashboardData(payload) {
  const normalized = normalizePayload(payload);
  writeLocalDashboard(normalized);
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      data: normalized,
      mode: 'local-disabled',
      message: `${configIssue || 'Supabase indisponible.'} Le dashboard n est pas sauvegarde localement.`,
    };
  }

  try {
    const { error } = await supabase.from(TABLE_NAME).upsert(
      {
        id: RECORD_ID,
        payload: normalized,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );

    if (error) {
      return {
        data: normalized,
        mode: 'local-disabled',
        message: 'Connexion Supabase indisponible. Le dashboard n est pas sauvegarde localement.',
      };
    }
  } catch {
    return {
      data: normalized,
      mode: 'local-disabled',
      message: 'Connexion Supabase indisponible. Le dashboard n est pas sauvegarde localement.',
    };
  }

  return {
    data: normalized,
    mode: 'supabase',
    message: 'Dashboard sauvegarde dans Supabase.',
  };
}

export function getDashboardSeedJson() {
  return JSON.stringify(defaultHrData, null, 2);
}
