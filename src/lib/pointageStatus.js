export const JUSTIFIED_POINTAGE_STATUSES = ['CONGE', 'CSS', 'CM', 'REPOS'];
export const CORRECTABLE_POINTAGE_STATUSES = ['POINTAGE', 'AVR', 'ABS', ...JUSTIFIED_POINTAGE_STATUSES];
export const POINTAGE_CORRECTION_CHOICES = ['POINTAGE', 'ABS', ...JUSTIFIED_POINTAGE_STATUSES];

const labels = {
  POINTAGE: 'Présence (horaires)', ABS: 'Absence non justifiée (ABS)',
  CONGE: 'Congé', CSS: 'Congé sans solde', CM: 'Congé maladie', REPOS: 'Repos',
};

export function pointageStatusLabel(status, translate = (_key, fallback) => fallback) {
  return translate(`daily.importScreen.correctionStatuses.${status}`, labels[status] || status);
}

export const pointageCorrectionKey = (correction) => `${correction.employeeKey}|${correction.isoDate}`;

// Preserve the latest RH decision, not an older leave that has since been replaced.
export function justifiedPointageCorrectionKeys(corrections) {
  const latest = new Map();
  for (const correction of corrections) {
    const key = pointageCorrectionKey(correction);
    const previous = latest.get(key);
    if (!previous || String(correction.correctedAt || '') >= String(previous.correctedAt || '')) latest.set(key, correction);
  }
  return new Set([...latest].filter(([, correction]) => JUSTIFIED_POINTAGE_STATUSES.includes(correction.after?.status)).map(([key]) => key));
}
