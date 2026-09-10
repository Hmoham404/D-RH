import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { analyzeEmployeeBaseFile } from './employeeBaseImport.js';
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
