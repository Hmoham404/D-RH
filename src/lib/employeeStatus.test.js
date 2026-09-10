import assert from 'node:assert/strict';
import test from 'node:test';
import { isEmployeeActiveInMonth, isEmployeeHiredInMonth, isEmployeeStcInMonth } from './employeeStatus.js';

const september = new Date(2026, 8, 10);
const stc = (inactiveFrom) => ({ status: 'STC', inactiveFrom });

test('September personnel includes current active staff and September exits only', () => {
  const employees = [
    { id: 'older-active', status: 'Actif', hiredAt: '15/08/2025' },
    { id: 'september-active', status: 'Actif', hiredAt: '30/09/2026' },
    { id: 'future-active', status: 'Actif', hiredAt: '2026-10-01' },
    { id: 'undated-active', status: 'Actif', hiredAt: '' },
    { id: 'august-stc', ...stc('AOUT') },
    { id: 'september-stc', ...stc('SEPTEMBRE') },
    { id: 'october-stc', ...stc('OCTOBRE') },
  ];
  const filtered = employees.filter((employee) => isEmployeeActiveInMonth(employee, september) || isEmployeeStcInMonth(employee, september));
  assert.deepEqual(filtered.map((employee) => employee.id), ['older-active', 'september-active', 'undated-active', 'september-stc']);
  assert.equal(isEmployeeActiveInMonth({ status: 'Actif', hiredAt: '31/02/2026' }, september), false);
});

test('recruitments use the hire month and year regardless of attendance or current status', () => {
  const employees = [
    { hiredAt: '01/09/2026', status: 'Actif', department: 'PRODUCTION' },
    { hiredAt: '30/09/2026', status: 'Actif', department: 'ADMINISTRATION' },
    { hiredAt: '2026-09-03', status: 'STC', department: 'PRODUCTION' },
    { hiredAt: '31/08/2026', status: 'Actif', department: 'PRODUCTION' },
    { hiredAt: '01/09/2025', status: 'Actif', department: 'PRODUCTION' },
    { hiredAt: '', status: 'Actif', department: 'PRODUCTION' },
  ];
  const hires = employees.filter(employee => isEmployeeHiredInMonth(employee, september));
  assert.equal(hires.length, 3);
  assert.equal(hires.filter(employee => employee.department === 'PRODUCTION').length, 2);
  assert.equal(isEmployeeHiredInMonth({ hired_at: ' 5-9-2026 ' }, september), true);
});

test('recruitments reject missing, incomplete and impossible dates', () => {
  for (const hiredAt of ['', null, '0', 0, 'SEPT', '09/2026', '31/09/2026', '2026-09-00', '2026-13-01', '29/02/2025']) {
    assert.equal(isEmployeeHiredInMonth({ hiredAt }, september), false, String(hiredAt));
  }
  assert.equal(isEmployeeHiredInMonth({ hiredAt: '29/02/2024' }, new Date(2024, 1, 1)), true);
  assert.equal(isEmployeeHiredInMonth({ hiredAt: '01/01/2027' }, new Date(2027, 0, 1)), true);
  assert.equal(isEmployeeHiredInMonth({ hiredAt: '01/01/2026' }, new Date(2027, 0, 1)), false);
});

test('September STC excludes earlier exits without making them active', () => {
  const employees = [stc('AOUT'), stc('SEPT'), stc('JUILLET'), { status: 'Actif', inactiveFrom: '' }];
  assert.deepEqual(employees.filter((employee) => isEmployeeStcInMonth(employee, september)), [stc('SEPT')]);
  assert.equal(employees.filter((employee) => employee.status === 'Actif').length, 1);
  assert.equal(employees[0].status, 'STC');
  assert.equal(employees.length, 4);
});

test('recognizes September names, abbreviations and dates', () => {
  for (const value of ['SEPT', ' sep. ', 'Septembre', 'SEPT 2026', 'septembre-2026', '09', '2026-09', '2026-09-15', '15/09/2026', '09/2026']) {
    assert.equal(isEmployeeStcInMonth(stc(value), september), true, value);
  }
  assert.equal(isEmployeeStcInMonth({ status: ' stc ', inactive_from: 'SEPT' }, september), true);
});

test('does not count previous years, future months, missing months or invalid dates', () => {
  for (const value of ['SEPT 2025', '15/09/2025', '2025-09-01', 'OCT', '', '0', 0, null, 'inconnu', '31/09/2026', '00/09/2026', '2026-13']) {
    assert.equal(isEmployeeStcInMonth(stc(value), september), false, String(value));
  }
  assert.equal(isEmployeeStcInMonth({ status: 'Actif', inactiveFrom: 'SEPT' }, september), false);
});

test('follows the reference month instead of hardcoding September', () => {
  assert.equal(isEmployeeStcInMonth(stc('AOÛT'), new Date(2026, 7, 31)), true);
  assert.equal(isEmployeeStcInMonth(stc('SEPT'), new Date(2026, 9, 1)), false);
  assert.equal(isEmployeeStcInMonth(stc('OCTOBRE'), new Date(2026, 9, 1)), true);
  assert.equal(isEmployeeStcInMonth(stc('DEC 2026'), new Date(2027, 0, 1)), false);
  assert.equal(isEmployeeStcInMonth(stc('JANV 2027'), new Date(2027, 0, 1)), true);
});
