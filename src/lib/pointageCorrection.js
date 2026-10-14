import * as XLSX from 'xlsx';
import { buildDailyTable, buildDailyWeeks, getCurrentFilePointage, prepareDailyPointage } from './dailyPointage.js';
import { preservePointageSourceMetadata } from './pointageSnapshotDates.js';

// UI confirmation only. Database authorization remains the responsibility of Supabase policies.
const RH_CODE_DIGEST = '39b095412ce8c4376ac1855e63444e4b0cf42a3d6af8ca22bf25337765033c35';
export async function verifyPointageCorrectionCode(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') === RH_CODE_DIGEST;
}

export function parsePointageCorrectionTime(value) {
  const input = String(value ?? '').trim();
  if (!input) return '';
  const match = input.match(/^(\d{1,2})(?::|h)?(\d{2})?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!match) throw new Error('Heure invalide. Utilisez 17:00, 5:00 PM ou 5:00 AM.');
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.replaceAll('.', '').toUpperCase();
  if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) {
    throw new Error('Heure invalide. Utilisez 17:00, 5:00 PM ou 5:00 AM.');
  }
  if (meridiem) hour = hour % 12 + (meridiem === 'PM' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export async function correctDailyPointage(snapshot, employees, { employeeKey, isoDate, entry = '', exit = '', breakMinutes }) {
  entry = parsePointageCorrectionTime(entry);
  exit = parsePointageCorrectionTime(exit);
  const current = getCurrentFilePointage(snapshot);
  const table = buildDailyTable(current, employees, [isoDate]);
  const person = table.rows.find((row) => row.employeeKey === employeeKey);
  const day = person?.days.find((item) => item.isoDate === isoDate);
  if (!day || !['POINTAGE', 'AVR', 'ABS'].includes(day.status)) throw new Error('Seuls les pointages présents, à vérifier et les ABS peuvent être corrigés.');
  if ((!entry && !exit) || ![entry, exit].every((value) => value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(value))) {
    throw new Error('Renseignez au moins une heure ; les heures saisies doivent être valides.');
  }
  if (entry && exit && exit <= entry) throw new Error('La sortie doit être après l’entrée, dans la même journée.');
  const matches = (row) => row.employeeKey === employeeKey && row.isoDate === isoDate;
  const originalRows = current.rawRows.filter(matches);
  const sourceRows = current.rawRows.filter((row) => !matches(row));
  const workbook = XLSX.utils.book_new();
  const rows = [['ID Emp.', 'Nom', 'Temps du Ptg', 'Terminal', 'Type de pointage'],
    ...sourceRows.map((row) => [row.sourceId, row.sourceName, row.pointageAt, row.terminal, row.pointageType]),
    ...[entry, exit].filter(Boolean).map((time) => [person.id, person.fullName, `${isoDate}T${time}:00`, 'Correction RH', '']),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Pointage');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const breakOverrides = { ...(current.calculationRules?.breakOverrides || {}), [`${employeeKey}|${isoDate}`]: Number(breakMinutes ?? current.calculationRules?.breakMinutes ?? 24) };
  const calculated = await prepareDailyPointage({ name: current.fileName || snapshot.fileName, arrayBuffer: async () => buffer }, employees, null,
    { roundingMinutes: 1, closeDays: true, ...current.calculationRules, breakOverrides, breakMinutes: current.calculationRules?.breakMinutes ?? 24,
      dateOrder: 'mdy' });
  const next = preservePointageSourceMetadata(calculated, sourceRows);
  const correction = { employeeKey, isoDate, fullName: person.fullName, correctedAt: new Date().toISOString(),
    before: { status: day.status, entry: day.entry, exit: day.exit, breakMinutes: day.breakMinutes, punches: originalRows },
    after: { entry, exit, breakMinutes: Number(breakMinutes ?? current.calculationRules?.breakMinutes ?? 24) } };
  const sourceWeeklySheets = current.sourceWeeklySheets || [];
  const manualCorrections = [...(snapshot.manualCorrections || []), correction];
  return { ...snapshot, ...next, sourceWeeklySheets,
    weeklySheets: buildDailyWeeks({ ...next, sourceWeeklySheets, manualCorrections }, employees),
    importId: snapshot.importId, generatedAt: snapshot.generatedAt,
    importDiagnostics: snapshot.importDiagnostics,
    manualCorrections,
    currentFilePointage: { ...next.currentFilePointage, sourceWeeklySheets,
      closedDates: current.calculationRules ? current.closedDates || [] : [...new Set(current.rawRows.map((row) => row.isoDate))],
      importDiagnostics: current.importDiagnostics,
      manualCorrections: [...(current.manualCorrections || []), correction] },
  };
}
