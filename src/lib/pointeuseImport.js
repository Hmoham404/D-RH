import * as XLSX from 'xlsx';
import { getCurrentFilePointage } from './dailyPointage.js';
import { preparePayrollPointage } from './payrollPointage.js';
import { getPayrollPeriod } from './pointagePeriod.js';

const normalizedCode = (value) => /^\d+$/.test(String(value).trim()) ? String(Number(value)) : String(value).trim();
const key = (id, timestamp) => `${normalizedCode(id)}|${timestamp}`;

// Clock timestamps are local calendar values, never converted through UTC.
export function getNewPointeuseRecords(records, snapshot, today) {
  if (!Array.isArray(records) || records.length > 100000) throw new Error('Invalid attendance response');
  const period = getPayrollPeriod(today);
  const current = getCurrentFilePointage(snapshot);
  const known = new Set((current?.rawRows || []).map((row) => key(row.sourceId || row.employeeKey, row.pointageAt)));
  const result = [];
  for (const record of records) {
    const id = String(record?.userId ?? '').trim();
    const timestamp = record?.timestamp;
    if (!id || typeof timestamp !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(timestamp)
      || !Number.isFinite(Date.parse(`${timestamp}Z`))
      || new Date(`${timestamp}Z`).toISOString().slice(0, 19) !== timestamp) throw new Error('Invalid attendance record');
    const date = timestamp.slice(0, 10);
    if (date < period.start || date > today) continue;
    const identity = key(id, timestamp);
    if (known.has(identity)) continue;
    known.add(identity);
    result.push({ userId: id, timestamp, terminal: String(record.terminal || '').slice(0, 100),
      punch: Number.isInteger(record.punch) ? record.punch : 0 });
  }
  return result;
}

export async function preparePointeuseImport(records, snapshot, employees, rules, today) {
  const additions = getNewPointeuseRecords(records, snapshot, today);
  if (!additions.length) return { snapshot: null, added: 0 };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['ID Emp.', 'Nom', 'Temps du Ptg', 'Terminal', 'Type de pointage'],
    ...additions.map((record) => [record.userId, '', record.timestamp, record.terminal, record.punch]),
  ]), 'SOURCE_POINTAGE');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const next = await preparePayrollPointage({ name: `pointeuses-${today}.xlsx`, arrayBuffer: async () => buffer },
    employees, snapshot, rules, today, { preserveCorrections: true });
  return { snapshot: next, added: additions.length };
}
