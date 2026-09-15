import * as XLSX from 'xlsx';
import { buildDailyTable, getCurrentFilePointage, prepareDailyPointage } from './dailyPointage.js';

// UI confirmation only. Database authorization remains the responsibility of Supabase policies.
const RH_CODE_DIGEST = '39b095412ce8c4376ac1855e63444e4b0cf42a3d6af8ca22bf25337765033c35';
export async function verifyPointageCorrectionCode(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') === RH_CODE_DIGEST;
}

export async function correctDailyPointage(snapshot, employees, { employeeKey, isoDate, entry, exit }) {
  const current = getCurrentFilePointage(snapshot);
  const table = buildDailyTable(current, employees, [isoDate]);
  const person = table.rows.find((row) => row.employeeKey === employeeKey);
  const day = person?.days.find((item) => item.isoDate === isoDate);
  if (!day || !['AVR', 'ABS'].includes(day.status)) throw new Error('Seuls les pointages à vérifier et les ABS peuvent être corrigés.');
  if (![entry, exit].every((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value))) {
    throw new Error('Renseignez une heure d’entrée et une heure de sortie valides.');
  }
  if (exit <= entry) throw new Error('La sortie doit être après l’entrée, dans la même journée.');
  const matches = (row) => row.employeeKey === employeeKey && row.isoDate === isoDate;
  const originalRows = current.rawRows.filter(matches);
  const sourceRows = current.rawRows.filter((row) => !matches(row));
  const workbook = XLSX.utils.book_new();
  const rows = [['ID Emp.', 'Nom', 'Temps du Ptg', 'Terminal', 'Type de pointage'],
    ...sourceRows.map((row) => [row.sourceId, row.sourceName, row.pointageAt, row.terminal, row.pointageType]),
    ...[entry, exit].map((time) => [person.id, person.fullName, `${isoDate}T${time}:00`, 'Correction RH', '']),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Pointage');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  // Remove replaced punches from accumulated history before recalculating, too.
  const previous = { ...snapshot, rawRows: (snapshot.rawRows || []).filter((row) => !matches(row)) };
  const next = await prepareDailyPointage({ name: current.fileName || snapshot.fileName, arrayBuffer: async () => buffer }, employees, previous,
    { breakMinutes: 0, roundingMinutes: 1, closeDays: true, ...current.calculationRules, dateOrder: 'mdy' });
  const correction = { employeeKey, isoDate, fullName: person.fullName, correctedAt: new Date().toISOString(),
    before: { status: day.status, entry: day.entry, exit: day.exit, punches: originalRows },
    after: { entry, exit } };
  return { ...snapshot, ...next, importId: snapshot.importId, generatedAt: snapshot.generatedAt,
    importDiagnostics: snapshot.importDiagnostics,
    manualCorrections: [...(snapshot.manualCorrections || []), correction],
    currentFilePointage: { ...next.currentFilePointage,
      closedDates: current.calculationRules ? current.closedDates || [] : [...new Set(current.rawRows.map((row) => row.isoDate))],
      importDiagnostics: current.importDiagnostics,
      manualCorrections: [...(current.manualCorrections || []), correction] },
  };
}
