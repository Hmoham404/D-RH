import assert from 'node:assert/strict';
import test from 'node:test';
import { isEmployeeActiveOnDate } from './employeeStatus.js';

const day = (value) => new Date(`${value}T12:00:00`);

test('historical active workforce follows hire and departure days, not current STC status', () => {
  const staff = [
    { id: 'retained', status: 'Actif', hiredAt: '01/01/2026' },
    { id: 'departed', status: 'STC', hiredAt: '01/01/2026', inactiveFrom: '29/10/2026' },
    { id: 'new', status: 'Actif', hiredAt: '30/10/2026' },
    { id: 'future', status: 'Actif', hiredAt: '01/11/2026' },
    { id: 'unknown-exit', status: 'STC' },
  ];
  const active = (date) => staff.filter((employee) => isEmployeeActiveOnDate(employee, day(date))).map(({ id }) => id);
  assert.deepEqual(active('2026-10-27'), ['retained', 'departed']);
  assert.deepEqual(active('2026-10-29'), ['retained']);
  assert.deepEqual(active('2026-10-30'), ['retained', 'new']);
  assert.equal(staff[1].status, 'STC');
});

test('dated departures take effect even when the saved status is still Actif', () => {
  const employee = { status: 'Actif', hired_at: '2026-01-01', inactive_from: '2026-10-29' };
  assert.equal(isEmployeeActiveOnDate(employee, day('2026-10-28')), true);
  assert.equal(isEmployeeActiveOnDate(employee, day('2026-10-29')), false);
});

test('historical dates support RH aliases and exclude unknown or invalid periods', () => {
  assert.equal(isEmployeeActiveOnDate({ status: 'STC', hired_at: '28/10/26', inactiveFrom: '', inactive_from: '30/10/26' }, day('2026-10-29')), true);
  assert.equal(isEmployeeActiveOnDate({ status: 'STC', hiredAt: '28/10/2026', inactiveFrom: '30/10/2026' }, day('2026-10-27')), false);
  for (const inactiveFrom of ['', 'OCT', '31/02/2026']) {
    assert.equal(isEmployeeActiveOnDate({ status: 'STC', inactiveFrom }, day('2026-10-27')), false);
  }
  assert.equal(isEmployeeActiveOnDate({ status: 'Actif', hiredAt: '31/02/2026' }, day('2026-10-27')), false);
  assert.equal(isEmployeeActiveOnDate({ status: 'Actif' }, new Date('invalid')), false);
  assert.equal(isEmployeeActiveOnDate({ status: 'Actif' }, day('2026-10-27')), true);
});
