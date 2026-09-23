import {
  formatSupabaseError,
  getSupabaseConfigIssue,
  hasSupabaseEnv,
  supabase,
} from '../lib/supabase';

const TABLE_NAME = 'hr_dashboard_store';
const RECORD_ID = 'rh-bus-capacities';
const LOCAL_STORAGE_KEY = 'rh-dashboard-bus-capacities';

function normalizeCapacities(value) {
  return Object.fromEntries(
    Object.entries(value && typeof value === 'object' ? value : {})
      .map(([bus, capacity]) => [String(bus || '').trim(), Math.round(Number(capacity))])
      .filter(([bus, capacity]) => bus && Number.isFinite(capacity) && capacity > 0),
  );
}

export function readLocalBusCapacities() {
  if (typeof window === 'undefined' || !window.localStorage) return {};

  try {
    return normalizeCapacities(JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY) || '{}'));
  } catch {
    return {};
  }
}

function writeLocalBusCapacities(capacities) {
  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalizeCapacities(capacities)));
  } catch {
    // Keep the app usable if browser storage is unavailable.
  }
}

export async function loadBusCapacities() {
  const local = readLocalBusCapacities();
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      data: local,
      mode: 'local-disabled',
      message: configIssue || 'Supabase indisponible. Capacites bus chargees localement.',
    };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('payload')
      .eq('id', RECORD_ID)
      .maybeSingle();

    if (error || !data?.payload) {
      return { data: local, mode: 'local-cache', message: 'Capacites bus locales chargees.' };
    }

    const remote = normalizeCapacities(data.payload.capacities || data.payload);
    writeLocalBusCapacities(remote);

    return { data: remote, mode: 'supabase', message: 'Capacites bus chargees depuis Supabase.' };
  } catch {
    return { data: local, mode: 'local-cache', message: 'Capacites bus locales chargees.' };
  }
}

export async function saveBusCapacities(capacities) {
  const normalized = normalizeCapacities(capacities);
  writeLocalBusCapacities(normalized);
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      data: normalized,
      mode: 'local-disabled',
      message: `${configIssue || 'Supabase indisponible.'} Capacites bus sauvegardees localement.`,
    };
  }

  try {
    const { error } = await supabase.from(TABLE_NAME).upsert(
      {
        id: RECORD_ID,
        payload: { capacities: normalized },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );

    if (error) {
      return {
        data: normalized,
        mode: 'local-disabled',
        message: `${formatSupabaseError(error, 'Capacites bus')} Sauvegarde locale appliquee.`,
      };
    }

    return { data: normalized, mode: 'supabase', message: 'Capacites bus sauvegardees dans Supabase.' };
  } catch (error) {
    return {
      data: normalized,
      mode: 'local-disabled',
      message: `${formatSupabaseError(error, 'Capacites bus')} Sauvegarde locale appliquee.`,
    };
  }
}
