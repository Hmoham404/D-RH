const LOCAL_APP_KEYS = [
  'myc-pointage-overrides-v1',
  'rh_employee_records_local',
  'rh_pointage_analysis_local',
  'rh_pointage_history_local',
  'rh_dashboard_snapshot_local',
];

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

export function clearLocalAppState() {
  if (!canUseStorage()) {
    return;
  }

  LOCAL_APP_KEYS.forEach((key) => {
    window.localStorage.removeItem(key);
  });
}

export function getLocalAppKeys() {
  return [...LOCAL_APP_KEYS];
}
