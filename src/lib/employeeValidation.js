function hasRealIdentityValue(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return Boolean(text) && !/^(?:[0o\s.,/_-]+|n\s*\/\s*a|null|undefined)$/.test(text);
}

// Department, service and generated record IDs do not establish an employee's identity.
export function hasMeaningfulEmployeeData(employee) {
  return [
    employee.finalCode ?? employee.final_code,
    employee.id,
    employee.zk,
    employee.saber,
    employee.fullName ?? employee.full_name,
    employee.lastName ?? employee.last_name,
    employee.firstName ?? employee.first_name,
  ].some(hasRealIdentityValue);
}

export function cleanInactiveFrom(value) {
  return hasRealIdentityValue(value) ? String(value).trim() : '';
}
