import employeesDirectory from '../employees.json';
import {
  formatSupabaseError,
  getSupabaseConfigIssue,
  hasSupabaseEnv,
  supabase,
} from '../lib/supabase';

const TABLE_NAME = 'hr_staff_directory';
const LOCAL_EMPLOYEES_KEY = 'rh_employee_records_local';
const LOCAL_DELETED_EMPLOYEES_KEY = 'rh_employee_deleted_records_local';

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildEmployeeRecordId(employee, index = 0) {
  const explicitRecordId = slugify(employee.recordId || employee.record_id);

  if (explicitRecordId) {
    return explicitRecordId;
  }

  const base = [
    cleanText(employee.id),
    cleanText(employee.finalCode || employee.final_code),
    cleanText(employee.zk),
    cleanText(employee.saber),
    cleanText(employee.fullName || employee.full_name),
    cleanText(employee.hiredAt || employee.hired_at),
  ]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return base || `employee-${index + 1}`;
}

export function createEmptyEmployee() {
  const timestamp = Date.now();

  return {
    recordId: `employee-${timestamp}`,
    id: '',
    zk: '',
    saber: '',
    finalCode: '',
    fullName: '',
    lastName: '',
    firstName: '',
    gender: '',
    kind: '',
    contract: '',
    department: '',
    service: '',
    job: '',
    hiredAt: '',
    payType: '',
    signed: '',
    status: 'Actif',
    inactiveFrom: '',
    userLevel: '',
  };
}

export function normalizeEmployee(employee, index = 0) {
  const lastName = cleanText(employee.lastName || employee.last_name);
  const firstName = cleanText(employee.firstName || employee.first_name);
  const fullName =
    cleanText(employee.fullName || employee.full_name) ||
    `${lastName} ${firstName}`.trim();

  return {
    recordId: buildEmployeeRecordId(employee, index),
    id: cleanText(employee.id),
    zk: cleanText(employee.zk),
    saber: cleanText(employee.saber),
    finalCode: cleanText(employee.finalCode || employee.final_code),
    fullName,
    lastName,
    firstName,
    gender: cleanText(employee.gender),
    kind: cleanText(employee.kind),
    contract: cleanText(employee.contract),
    department: cleanText(employee.department),
    service: cleanText(employee.service),
    job: cleanText(employee.job),
    hiredAt: cleanText(employee.hiredAt || employee.hired_at),
    payType: cleanText(employee.payType || employee.pay_type),
    signed: cleanText(employee.signed),
    status: cleanText(employee.status),
    inactiveFrom: cleanText(employee.inactiveFrom || employee.inactive_from),
    userLevel: cleanText(employee.userLevel || employee.user_level),
  };
}

function mapRowToEmployee(row, index = 0) {
  return normalizeEmployee(row, index);
}

function mapEmployeeToRow(employee) {
  const normalized = normalizeEmployee(employee);

  return {
    record_id: normalized.recordId,
    id: normalized.id,
    zk: normalized.zk,
    saber: normalized.saber,
    final_code: normalized.finalCode,
    full_name: normalized.fullName,
    last_name: normalized.lastName,
    first_name: normalized.firstName,
    gender: normalized.gender,
    kind: normalized.kind,
    contract: normalized.contract,
    department: normalized.department,
    service: normalized.service,
    job: normalized.job,
    hired_at: normalized.hiredAt,
    pay_type: normalized.payType,
    signed: normalized.signed,
    status: normalized.status,
    inactive_from: normalized.inactiveFrom,
    updated_at: new Date().toISOString(),
  };
}

export const localEmployeesSeed = employeesDirectory.map((employee, index) =>
  normalizeEmployee(employee, index),
);

function sortEmployees(items) {
  return [...items].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function getEmployeeIdentityKey(employee) {
  const normalized = normalizeEmployee(employee);
  const codeKey = [
    cleanText(normalized.finalCode),
    cleanText(normalized.id),
    cleanText(normalized.zk),
    cleanText(normalized.saber),
  ]
    .filter(Boolean)
    .join('|');

  if (codeKey) {
    return `code:${codeKey}`;
  }

  const personKey = [
    cleanText(normalized.fullName).toLowerCase(),
    cleanText(normalized.hiredAt),
    cleanText(normalized.department).toLowerCase(),
    cleanText(normalized.service).toLowerCase(),
  ]
    .filter(Boolean)
    .join('|');

  if (personKey) {
    return `person:${personKey}`;
  }

  return `record:${cleanText(normalized.recordId)}`;
}

function dedupeEmployees(items) {
  const deduped = new Map();

  items.forEach((employee, index) => {
    const normalized = normalizeEmployee(employee, index);
    const identityKey = getEmployeeIdentityKey(normalized);
    deduped.set(identityKey, normalized);
  });

  return sortEmployees([...deduped.values()]);
}

function findEmployeeIndex(list, employee, fallbackRecordId = '') {
  const normalized = normalizeEmployee(employee);
  const candidateRecordIds = [
    cleanText(fallbackRecordId),
    cleanText(employee.lockedRecordId),
    cleanText(employee.recordId),
    cleanText(normalized.recordId),
  ].filter(Boolean);

  const codeKeys = ['finalCode', 'id', 'zk', 'saber'];

  return list.findIndex((currentEmployee) => {
    if (candidateRecordIds.includes(cleanText(currentEmployee.recordId))) {
      return true;
    }

    for (const key of codeKeys) {
      const currentValue = cleanText(currentEmployee[key]);
      const nextValue = cleanText(normalized[key]);

      if (currentValue && nextValue && currentValue === nextValue) {
        return true;
      }
    }

    return Boolean(
      cleanText(currentEmployee.fullName) &&
      cleanText(normalized.fullName) &&
      cleanText(currentEmployee.fullName) === cleanText(normalized.fullName) &&
      cleanText(currentEmployee.hiredAt) &&
      cleanText(normalized.hiredAt) &&
      cleanText(currentEmployee.hiredAt) === cleanText(normalized.hiredAt),
    );
  });
}

function readLocalEmployees() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_EMPLOYEES_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return applyDeletedRecordFilter(
      dedupeEmployees(parsed.map((employee, index) => normalizeEmployee(employee, index))),
    );
  } catch {
    return [];
  }
}

function readDeletedRecordIds() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_DELETED_EMPLOYEES_KEY);
    if (!raw) {
      return new Set();
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(parsed.map((value) => cleanText(value)).filter(Boolean));
  } catch {
    return new Set();
  }
}

function writeDeletedRecordIds(recordIds) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(
      LOCAL_DELETED_EMPLOYEES_KEY,
      JSON.stringify([...new Set([...recordIds].map((value) => cleanText(value)).filter(Boolean))]),
    );
  } catch {
    // Ignore local storage write errors so the app stays usable.
  }
}

function applyDeletedRecordFilter(employeeList) {
  const deletedRecordIds = readDeletedRecordIds();

  if (!deletedRecordIds.size) {
    return Array.isArray(employeeList) ? employeeList : [];
  }

  return (Array.isArray(employeeList) ? employeeList : []).filter(
    (employee) => !deletedRecordIds.has(cleanText(employee?.recordId)),
  );
}

function writeLocalEmployees(employeeList) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    const normalizedEmployees = applyDeletedRecordFilter(
      dedupeEmployees(
        (Array.isArray(employeeList) ? employeeList : []).map((employee, index) =>
          normalizeEmployee(employee, index),
        ),
      ),
    );
    window.localStorage.setItem(LOCAL_EMPLOYEES_KEY, JSON.stringify(normalizedEmployees));
  } catch {
    // Ignore local storage write errors so the app stays usable.
  }
}

function mergeEmployees(baseEmployees, incomingEmployees) {
  const merged = dedupeEmployees(baseEmployees).map((employee, index) =>
    normalizeEmployee(employee, index),
  );

  incomingEmployees.forEach((employee, index) => {
    const normalized = normalizeEmployee(employee, index);
    const existingIndex = findEmployeeIndex(merged, employee);

    if (existingIndex >= 0) {
      merged[existingIndex] = normalized;
      return;
    }

    merged.push(normalized);
  });

  return dedupeEmployees(merged);
}

function mergeLocalOnlyFields(remoteEmployees, localEmployees = []) {
  return remoteEmployees.map((employee) => {
    const localMatchIndex = findEmployeeIndex(localEmployees, employee);

    if (localMatchIndex < 0) {
      return employee;
    }

    const localMatch = normalizeEmployee(localEmployees[localMatchIndex]);

    return {
      ...employee,
      userLevel: employee.userLevel || localMatch.userLevel || '',
    };
  });
}

function upsertEmployeeLocally(employee) {
  const normalized = normalizeEmployee(employee);
  const deletedRecordIds = readDeletedRecordIds();

  if (cleanText(normalized.recordId)) {
    deletedRecordIds.delete(cleanText(normalized.recordId));
    writeDeletedRecordIds(deletedRecordIds);
  }

  const currentEmployees = readLocalEmployees();
  const nextEmployees = mergeEmployees(currentEmployees, [normalized]);
  writeLocalEmployees(nextEmployees);
  return {
    employee: normalized,
    employees: sortEmployees(nextEmployees),
  };
}

function removeEmployeeLocally(employee, fallbackRecordId = '') {
  const currentEmployees = readLocalEmployees();
  const targetIndex = findEmployeeIndex(currentEmployees, employee, fallbackRecordId);
  const removed =
    targetIndex >= 0
      ? normalizeEmployee(currentEmployees[targetIndex])
      : normalizeEmployee(employee || { recordId: fallbackRecordId || '' });
  const nextEmployees =
    targetIndex >= 0
      ? currentEmployees.filter((_, index) => index !== targetIndex)
      : currentEmployees;

  const deletedRecordIds = readDeletedRecordIds();
  const removedRecordId = cleanText(removed?.recordId) || cleanText(targetRecordId);

  if (removedRecordId) {
    deletedRecordIds.add(removedRecordId);
    writeDeletedRecordIds(deletedRecordIds);
  }

  writeLocalEmployees(nextEmployees);

  return {
    removed,
    employees: sortEmployees(nextEmployees),
  };
}

export async function loadEmployees() {
  const storedEmployees = readLocalEmployees();
  const localFallbackEmployees = storedEmployees.length
    ? storedEmployees
    : applyDeletedRecordFilter(sortEmployees(localEmployeesSeed));
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      data: localFallbackEmployees,
      mode: storedEmployees.length ? 'local-cache' : 'local-disabled',
      message: storedEmployees.length
        ? `${storedEmployees.length} fiche(s) employe chargee(s) depuis la base locale du navigateur.`
        : configIssue || 'Supabase indisponible. Aucune sauvegarde locale des employes n est conservee.',
    };
  }

  try {
    const { data, error } = await supabase.from(TABLE_NAME).select('*').order('full_name');

    if (error) {
      return {
        data: localFallbackEmployees,
        mode: storedEmployees.length ? 'local-cache' : 'local-disabled',
        message: storedEmployees.length
          ? 'Connexion Supabase indisponible. Base RH locale chargee depuis ce navigateur.'
          : 'Connexion Supabase indisponible. Aucune sauvegarde locale des employes n est utilisee.',
      };
    }

    if (!data?.length) {
      const emptyRemoteEmployees = storedEmployees.length
        ? storedEmployees
        : applyDeletedRecordFilter(sortEmployees(localEmployeesSeed));
      return {
        data: emptyRemoteEmployees,
        mode: storedEmployees.length ? 'local-cache' : 'remote-empty',
        message: storedEmployees.length
          ? 'Table Supabase vide. Base RH locale conservee dans ce navigateur.'
          : 'Table rh_employee_records vide. Clique sur "Publier employes" pour envoyer la base en ligne.',
      };
    }

    const remoteEmployees = applyDeletedRecordFilter(
      mergeLocalOnlyFields(dedupeEmployees(data.map(mapRowToEmployee)), storedEmployees),
    );
    writeLocalEmployees(remoteEmployees);

    return {
      data: remoteEmployees,
      mode: 'supabase',
      message: `${remoteEmployees.length} fiche(s) employe chargee(s) depuis Supabase.`,
    };
  } catch (error) {
      return {
        data: localFallbackEmployees,
        mode: storedEmployees.length ? 'local-cache' : 'local-disabled',
        message: storedEmployees.length
          ? 'Connexion Supabase indisponible. Base RH locale chargee depuis ce navigateur.'
          : 'Connexion Supabase indisponible. Aucune sauvegarde locale des employes n est utilisee.',
      };
  }
}

export async function saveEmployeeRecord(employee) {
  const localSave = upsertEmployeeLocally(employee);
  const normalized = localSave.employee;
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      employee: normalized,
      employees: localSave.employees,
      mode: 'local-disabled',
      message: `${configIssue || 'Supabase indisponible.'} La fiche de ${normalized.fullName || 'ce collaborateur'} est sauvegardee dans la base locale du navigateur.`,
    };
  }

  const row = mapEmployeeToRow(normalized);
  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .upsert(row, { onConflict: 'record_id' })
      .select()
      .single();

    if (error) {
      return {
        employee: normalized,
        employees: localSave.employees,
        mode: 'local-disabled',
        message: `Connexion Supabase indisponible. La fiche de ${normalized.fullName || 'ce collaborateur'} reste sauvegardee dans la base locale du navigateur.`,
      };
    }

    const savedEmployee = {
      ...mapRowToEmployee(data),
      userLevel: normalized.userLevel,
    };
    const syncedSave = upsertEmployeeLocally(savedEmployee);

    return {
      employee: savedEmployee,
      employees: syncedSave.employees,
      mode: 'supabase',
      message: `Fiche de ${savedEmployee.fullName} sauvegardee dans Supabase.`,
    };
  } catch {
    return {
      employee: normalized,
      employees: localSave.employees,
      mode: 'local-disabled',
      message: `Connexion Supabase indisponible. La fiche de ${normalized.fullName || 'ce collaborateur'} reste sauvegardee dans la base locale du navigateur.`,
    };
  }
}

export async function syncEmployeesToSupabase(employeeList = localEmployeesSeed) {
  const normalizedEmployees = sortEmployees(
    employeeList.map((employee, index) => normalizeEmployee(employee, index)),
  );
  writeLocalEmployees(normalizedEmployees);
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    throw new Error(configIssue || 'Supabase non configure. Remplis le fichier .env.');
  }

  try {
    const rows = normalizedEmployees.map(mapEmployeeToRow);
    const { error } = await supabase.from(TABLE_NAME).upsert(rows, { onConflict: 'record_id' });

    if (error) {
      throw new Error(formatSupabaseError(error, 'Publication employes'));
    }

    return normalizedEmployees;
  } catch (error) {
    throw new Error(formatSupabaseError(error, 'Publication employes'));
  }
}

export async function deleteEmployeeRecord(employee, fallbackRecordId = '') {
  const targetRecordId =
    cleanText(fallbackRecordId) ||
    cleanText(employee?.lockedRecordId) ||
    cleanText(employee?.recordId);
  const { removed, employees } = removeEmployeeLocally(employee, targetRecordId);
  const removedName = removed?.fullName || employee?.fullName || 'cette fiche';
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      removed,
      employees,
      mode: 'local-disabled',
      message: `${configIssue || 'Supabase indisponible.'} La fiche de ${removedName} est supprimee de la base locale du navigateur.`,
    };
  }

  try {
    const { error } = await supabase.from(TABLE_NAME).delete().eq('record_id', targetRecordId);

    if (error) {
      return {
        removed,
        employees,
        mode: 'local-disabled',
        message: `Connexion Supabase indisponible. La fiche de ${removedName} reste supprimee de la base locale du navigateur.`,
      };
    }

    return {
      removed,
      employees,
      mode: 'supabase',
      message: `Fiche de ${removedName} supprimee dans Supabase.`,
    };
  } catch {
    return {
      removed,
      employees,
      mode: 'local-disabled',
      message: `Connexion Supabase indisponible. La fiche de ${removedName} reste supprimee de la base locale du navigateur.`,
    };
  }
}
