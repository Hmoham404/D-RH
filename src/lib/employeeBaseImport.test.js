import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { analyzeEmployeeBaseFile, normalizeEmployeeRhDate, normalizeEmployeeStatus } from './employeeBaseImport.js';
import { hasMeaningfulEmployeeData } from './employeeValidation.js';
import { isEmployeeHiredInMonth } from './employeeStatus.js';

async function importRows(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Etat du personnel');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return analyzeEmployeeBaseFile({ name: 'personnel-septembre.xlsx', arrayBuffer: async () => bytes });
}

test('imports text and native Excel hire dates for monthly recruitment counts', async () => {
  const serial = (date) => (Date.parse(date) - Date.UTC(1899, 11, 30)) / 86400000;
  const { employees } = await importRows([
    ['Code', 'Nom complet', "Date d'embauche", 'Departement', 'Actif/Inactif'],
    ['001', 'TEST A', '02/09/2026', 'PRODUCTION', 'Actif'],
    [],
    ['002', 'TEST B', { t: 'n', v: serial('2026-09-04'), z: 'mm/dd/yy' }, 'PRODUCTION', 'STC'],
    ['003', 'TEST C', serial('2026-09-05'), 'ADMINISTRATION', 'Actif'],
    ['004', 'TEST D', { t: 'n', v: serial('2026-08-31'), z: 'dd/mm/yyyy' }, 'PRODUCTION', 'Actif'],
    ['005', 'TEST E', 0, 'PRODUCTION', 'Actif'],
  ]);
  assert.equal(employees.length, 5);
  assert.deepEqual(employees.map(employee => employee.hiredAt), ['02/09/2026', '04/09/2026', '05/09/2026', '31/08/2026', '']);
  assert.equal(employees.filter(employee => isEmployeeHiredInMonth(employee, new Date(2026, 8, 1))).length, 3);
});

test('imports September personnel with the original status and inactive month', async () => {
  const { employees } = await importRows([
    ['Matr ZK', 'Matr. Saber', 'Matr. FINAL', 'Nom', 'Prénom', 'Genre', 'MOI/MOD', 'TYPE DE CONTRAT', 'Departement', 'Service', 'FONCTION', 'Catégories', 'Type paye', 'Contrat signé', 'Actif/Inactif', 'Inactif A PARTIR'],
    ['', '0003', '003', 'PERSONNE', 'A', 'F', 'MOI', 'CDI', 'ADMINISTRATION', 'QUALITE', 'TECH', 'MAITRISE', 'Mensuel', 'Oui', 'STC', 'AOUT'],
    ['', '0004', '004', 'PERSONNE', 'B', 'H', 'MOI', 'CDI', 'ADMINISTRATION', 'METHOD INDUS', 'TECH', 'MAITRISE', 'Mensuel', 'Oui', 'Actif', 0],
    ['', '0017', '017', 'PERSONNE', 'C', 'H', 'MOD', 'CDI', 'PRODUCTION', 'INJ', 'OPER', 'EXECUTION', 'Horaire', 'Oui', 'STC', 'SEPT'],
    Array(16).fill(0),
    ['', '0', '0', '0', '0', '', '', '', 'ADMINISTRATION', '', '', '', '', '', 'Actif', 0],
  ]);
  assert.equal(employees.length, 3);
  assert.deepEqual(employees.map(({ finalCode, status, inactiveFrom }) => ({ finalCode, status, inactiveFrom })), [
    { finalCode: '003', status: 'STC', inactiveFrom: 'AOUT' },
    { finalCode: '004', status: 'Actif', inactiveFrom: '' },
    { finalCode: '017', status: 'STC', inactiveFrom: 'SEPT' },
  ]);
  assert.equal(employees.filter((employee) => employee.status === 'Actif').length, 1);
  assert.equal(employees.filter((employee) => employee.status === 'STC').length, 2);
  assert.equal(employees[0].fullName, 'PERSONNE A');
  assert.equal(employees[0].saber, '0003');
  assert.equal(employees[0].payType, 'Mensuel');
  assert.equal(employees[0].signed, 'Oui');
  assert.equal(employees[0].contract, 'CDI');
  assert.equal(employees[0].kind, 'MOI');
});

test('zero exit dates do not make employees inactive when status is absent', async () => {
  const { employees } = await importRows([
    ['Code', 'Nom complet', 'Département', 'Inactif A PART'],
    ['001', 'PERSONNE A', 'PRODUCTION', 0],
    ['002', 'PERSONNE B', 'PRODUCTION', 'SEPT'],
  ]);
  assert.deepEqual(employees.map((employee) => employee.status), ['Actif', 'STC']);
});

test('recognizes exported columns and gives MOI/MOD priority over Categories', async () => {
  const { employees } = await importRows([
    ['Code', 'Nom', 'Catégories', 'MOI/MOD', 'Statut', 'Inactif_Depuis', 'Contrat signé', 'Contrat'],
    ['003', 'PERSONNE A', 'MAITRISE', 'MOI', 'Inactif', 'SEPT', 'Oui', 'CDI'],
  ]);
  assert.equal(employees[0].fullName, 'PERSONNE A');
  assert.equal(employees[0].kind, 'MOI');
  assert.equal(employees[0].contract, 'CDI');
  assert.equal(employees[0].signed, 'Oui');
  assert.equal(employees[0].status, 'STC');
  assert.equal(employees[0].inactiveFrom, 'SEPT');
});

test('RH exit dates decode native Excel serials as calendar dates despite US and General display formats', async () => {
  const serial = (year, month, day) => (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000;
  const { employees } = await importRows([
    ['Code', 'Nom complet', 'Departement', 'Actif/Inactif', 'Inactif A PARTIR'],
    ['001', 'SORTIE SEPTEMBRE', 'PRODUCTION', 'STC', { t: 'n', v: serial(2026, 9, 29), z: 'm/d/yy h:mm' }],
    ['002', 'SORTIE OCTOBRE', 'PRODUCTION', 'STC', { t: 'n', v: serial(2026, 10, 1), z: 'm/d/yy' }],
    ['003', 'SORTIE OCTOBRE GENERAL', 'PRODUCTION', 'STC', serial(2026, 10, 1)],
    ['004', 'ACTIF ZERO', 'PRODUCTION', 'Actif', 0],
  ]);
  assert.deepEqual(employees.map((employee) => employee.inactiveFrom), ['29/09/2026', '01/10/2026', '01/10/2026', '']);
  assert.deepEqual(employees.map((employee) => employee.status), ['STC', 'STC', 'STC', 'Actif']);
});

test('explicit Actif/Inactif source column wins over generic status and shortened exported header is recognized', async () => {
  const { employees } = await importRows([
    ['Code', 'Nom complet', 'Departement', 'Statut', 'Actif Inac...', 'Inactif A PARTIR'],
    ['001', 'SORTIE SEPTEMBRE', 'PRODUCTION', 'Actif', 'STC', '29/09/2026'],
    ['002', 'SORTIE OCTOBRE', 'PRODUCTION', 'Actif', 'Inactif', '01/10/2026'],
  ]);
  assert.deepEqual(employees.map((employee) => employee.status), ['STC', 'STC']);
  assert.deepEqual(employees.map((employee) => employee.inactiveFrom), ['29/09/2026', '01/10/2026']);
});

test('RH date normalization retains French textual dates through SQL-shaped JSON roundtrips', () => {
  for (const [input, expected] of [['01/10/2026', '01/10/2026'], ['10/01/2026', '10/01/2026'],
    ['2026-10-01', '01/10/2026'], ['01/10/26', '01/10/2026'], ['9/29/26', '29/09/2026']]) {
    const row = JSON.parse(JSON.stringify({ inactive_from: normalizeEmployeeRhDate(input, { allowMonthOnly: true }), status: 'Inactif' }));
    assert.equal(row.inactive_from, expected);
    assert.equal(normalizeEmployeeRhDate(row.inactive_from, { allowMonthOnly: true }), expected);
    assert.equal(normalizeEmployeeStatus(row.status, row.inactive_from), 'STC');
  }
  assert.equal(normalizeEmployeeRhDate(0, { allowMonthOnly: true }), '');
  assert.equal(normalizeEmployeeRhDate('SEPT', { allowMonthOnly: true }), 'SEPT');
  assert.equal(normalizeEmployeeRhDate(9, { allowMonthOnly: true }), '9');
  assert.equal(normalizeEmployeeRhDate('31/02/2026'), '');
});

test('extended departure headers cannot be mistaken for the Actif status column', async () => {
  for (const header of ['Inactif A PARTIR DU', 'Inactif à partir de', 'Date sortie effective']) {
    const { employees } = await importRows([
      ['Code', 'Nom complet', 'Departement', 'Actif/Inactif', header],
      ['21', 'DEPART SEPT29', 'PRODUCTION', 'STC', '29/09/2026'],
      ['22', 'DEPART OCT1', 'PRODUCTION', 'STC', '01/10/2026'],
    ]);
    assert.deepEqual(employees.map((employee) => employee.inactiveFrom), ['29/09/2026', '01/10/2026'], header);
    assert.deepEqual(employees.map((employee) => employee.status), ['STC', 'STC'], header);
  }
});

test('RH native departure dates retain their calendar day in the Excel 1904 date system', async () => {
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { WBProps: { date1904: true } };
  const serial = (Date.UTC(2026, 9, 1) - Date.UTC(1904, 0, 1)) / 86400000;
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Code', 'Nom', 'Departement', 'Actif/Inactif', 'Inactif A PARTIR DU'],
    ['22', 'DEPART OCT1', 'PRODUCTION', 'STC', { t: 'n', v: serial, z: 'm/d/yy h:mm' }],
  ]), 'Personnel');
  const result = await analyzeEmployeeBaseFile({ name: 'personnel-1904.xlsx', arrayBuffer: async () => XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) });
  assert.equal(result.employees[0].inactiveFrom, '01/10/2026');
});

test('rejects placeholder identities from Excel, browser cache and database shapes', () => {
  for (const employee of [
    { finalCode: '0', fullName: '0 0', department: 'ADMINISTRATION' },
    { final_code: '000', full_name: 'o o', record_id: 'employee-1' },
    { id: '0', fullName: '0', firstName: '0', lastName: '0' },
    { department: 'PRODUCTION', service: 'INJ' },
    {},
  ]) {
    assert.equal(hasMeaningfulEmployeeData(employee), false);
  }
  for (const employee of [
    { finalCode: '003', fullName: '' },
    { fullName: 'PERSONNE A', finalCode: '' },
    { id: '0', fullName: 'PERSONNE B' },
    { final_code: '017', full_name: 'PERSONNE C' },
  ]) {
    assert.equal(hasMeaningfulEmployeeData(employee), true);
  }
});

test('refuses a placeholder-only workbook to avoid replacing the base with no employees', async () => {
  await assert.rejects(importRows([
    ['Code', 'Nom', 'Prénom', 'Département'],
    [0, 0, 0, 'ADMINISTRATION'],
    ['000', 'o', 'o', 'PRODUCTION'],
  ]), /aucune fiche exploitable/);
});
