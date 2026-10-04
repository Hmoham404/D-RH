import employeesDirectory from '../employees.json';
import { cleanInactiveFrom, hasMeaningfulEmployeeData } from '../lib/employeeValidation.js';
import { normalizeEmployeeRhDate, normalizeEmployeeStatus } from '../lib/employeeBaseImport.js';
import {
  formatSupabaseError,
  getSupabaseConfigIssue,
  hasSupabaseEnv,
  supabase,
} from '../lib/supabase';

const TABLE_NAME = 'hr_staff_directory';
const DIRECTORY_STATE_TABLE = 'hr_dashboard_store';
const DIRECTORY_STATE_ID = 'rh-staff-directory-active-records';
const LOCAL_EMPLOYEES_KEY = 'rh_employee_records_local';
const LOCAL_DELETED_EMPLOYEES_KEY = 'rh_employee_deleted_records_local';

function cleanText(value) {
  return String(value ?? '').trim();
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
    address: '',
    bus: '',
    departureReason: '',
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
  const inactiveFrom = cleanInactiveFrom(normalizeEmployeeRhDate(employee.inactiveFrom || employee.inactive_from, { allowMonthOnly: true }));

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
    hiredAt: normalizeEmployeeRhDate(employee.hiredAt || employee.hired_at),
    address: cleanText(employee.address),
    bus: cleanText(employee.bus),
    departureReason: cleanText(employee.departureReason || employee.departure_reason),
    payType: cleanText(employee.payType || employee.pay_type),
    signed: cleanText(employee.signed),
    status: normalizeEmployeeStatus(employee.status, inactiveFrom),
    inactiveFrom,
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
    address: normalized.address,
    bus: normalized.bus,
    departure_reason: normalized.departureReason,
    pay_type: normalized.payType,
    signed: normalized.signed,
    status: normalized.status,
    inactive_from: normalized.inactiveFrom,
    updated_at: new Date().toISOString(),
  };
}

export const localEmployeesSeed = employeesDirectory.filter(hasMeaningfulEmployeeData).map((employee, index) =>
  normalizeEmployee(employee, index),
);

function sortEmployees(items) {
  const getEmployeeCode = (employee) =>
    cleanText(employee.finalCode || employee.id || employee.zk || employee.saber);

  return [...items].sort((left, right) => {
    const codeSort = getEmployeeCode(left).localeCompare(getEmployeeCode(right), undefined, {
      numeric: true,
      sensitivity: 'base',
    });

    return codeSort || left.fullName.localeCompare(right.fullName);
  });
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
    if (!hasMeaningfulEmployeeData(normalized)) {
      return;
    }
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

function hasLocalEmployeesCache() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }

  try {
    return window.localStorage.getItem(LOCAL_EMPLOYEES_KEY) !== null;
  } catch {
    return false;
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

function clearLocalEmployeesState() {
  writeDeletedRecordIds(new Set());
  writeLocalEmployees([]);
}

async function loadActiveDirectoryRecordIds() {
  const { data, error } = await supabase
    .from(DIRECTORY_STATE_TABLE)
    .select('payload')
    .eq('id', DIRECTORY_STATE_ID)
    .maybeSingle();

  if (error || !Array.isArray(data?.payload?.recordIds)) {
    return null;
  }

  return new Set(data.payload.recordIds.map((value) => cleanText(value)).filter(Boolean));
}

async function saveActiveDirectoryRecordIds(employees = []) {
  const recordIds = employees.map((employee) => cleanText(employee.recordId)).filter(Boolean);
  const { error } = await supabase.from(DIRECTORY_STATE_TABLE).upsert(
    {
      id: DIRECTORY_STATE_ID,
      payload: { recordIds },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );

  if (error) {
    throw error;
  }
}

async function activateSavedEmployee(recordId) {
  const { data: state, error: stateError } = await supabase
    .from(DIRECTORY_STATE_TABLE)
    .select('payload')
    .eq('id', DIRECTORY_STATE_ID)
    .maybeSingle();
  if (stateError) throw stateError;

  let activeIds = Array.isArray(state?.payload?.recordIds)
    ? new Set(state.payload.recordIds.map((value) => cleanText(value)).filter(Boolean))
    : null;
  if (activeIds) {
    activeIds.add(cleanText(recordId));
  } else {
    // Older installations may not have a directory state row. Keep every existing
    // remote employee active when creating that row for the first time.
    const { data: rows, error: rowsError } = await supabase.from(TABLE_NAME).select('record_id');
    if (rowsError) throw rowsError;
    activeIds = new Set((rows || []).map((row) => cleanText(row.record_id)).filter(Boolean));
    activeIds.add(cleanText(recordId));
  }

  const { error } = await supabase.from(DIRECTORY_STATE_TABLE).upsert(
    { id: DIRECTORY_STATE_ID, payload: { recordIds: [...activeIds] }, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  );
  if (error) throw error;
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

function buildPreparedEmployeeList(employeeList = [], preservedEmployees = []) {
  const normalizedEmployees = dedupeEmployees(
    (Array.isArray(employeeList) ? employeeList : []).map((employee, index) =>
      normalizeEmployee(employee, index),
    ),
  );

  return sortEmployees(mergeLocalOnlyFields(normalizedEmployees, preservedEmployees));
}

async function deleteAllRemoteEmployees() {
  const batchSize = 100;
  let removedCount = 0;

  // Delete in small batches so long record-id lists never exceed the REST URL limit.
  while (true) {
    const { data, error } = await supabase.from(TABLE_NAME).select('record_id').limit(batchSize);

    if (error) {
      throw error;
    }

    const recordIds = (Array.isArray(data) ? data : [])
      .map((row) => cleanText(row.record_id))
      .filter(Boolean);

    if (!recordIds.length) {
      return removedCount;
    }

    const { error: deleteError } = await supabase.from(TABLE_NAME).delete().in('record_id', recordIds);

    if (deleteError) {
      throw deleteError;
    }

    // PostgREST can return no deleted rows even after success, so verify against the source table.
    const { data: remainingRows, error: verificationError } = await supabase
      .from(TABLE_NAME)
      .select('record_id')
      .in('record_id', recordIds);

    if (verificationError) {
      throw verificationError;
    }

    if (remainingRows?.length) {
      throw new Error('Aucune fiche n a pu etre supprimee de la base partagee.');
    }

    removedCount += recordIds.length;
  }
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
  const removedRecordId = cleanText(removed?.recordId) || cleanText(fallbackRecordId);

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
  const localCacheExists = hasLocalEmployeesCache();
  const localFallbackEmployees = localCacheExists
    ? storedEmployees
    : applyDeletedRecordFilter(sortEmployees(localEmployeesSeed));
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      data: localFallbackEmployees,
      mode: localCacheExists ? 'local-cache' : 'local-disabled',
      message: localCacheExists
        ? `${storedEmployees.length} fiche(s) employe chargee(s) depuis la base locale du navigateur.`
        : configIssue || 'Supabase indisponible. Aucune sauvegarde locale des employes n est conservee.',
    };
  }

  try {
    const activeRecordIds = await loadActiveDirectoryRecordIds();
    let directoryRows = [];

    if (activeRecordIds) {
      const activeIds = [...activeRecordIds];
      // Supabase caps each response page. Fetch the authoritative active IDs in
      // small batches so larger directories are never silently truncated.
      for (let offset = 0; offset < activeIds.length; offset += 100) {
        const { data, error } = await supabase
          .from(TABLE_NAME)
          .select('*')
          .in('record_id', activeIds.slice(offset, offset + 100));
        if (error) throw error;
        directoryRows.push(...(data || []));
      }
    } else {
      // Legacy installs without an active-ID list need explicit pagination too.
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from(TABLE_NAME)
          .select('*')
          .order('full_name')
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        directoryRows.push(...(data || []));
        if ((data || []).length < pageSize) break;
      }
    }

    if (!directoryRows.length) {
      // The shared directory is authoritative: remove stale browser copies when it is empty.
      clearLocalEmployeesState();
      return {
        data: [],
        mode: 'remote-empty',
        message: 'Table des employes vide. Importez un fichier Excel pour creer la nouvelle base.',
      };
    }

    // Supabase is authoritative after a successful fetch. Browser tombstones are
    // only a local fallback; applying them here can hide valid remote employees
    // after an earlier delete failed partway through its online synchronization.
    const remoteEmployees = mergeLocalOnlyFields(
      dedupeEmployees(directoryRows.map(mapRowToEmployee)),
      storedEmployees,
    );
    if (activeRecordIds) writeDeletedRecordIds(new Set());
    writeLocalEmployees(remoteEmployees);

    return {
      data: remoteEmployees,
      mode: 'supabase',
      message: `${remoteEmployees.length} fiche(s) employe chargee(s) depuis Supabase.`,
    };
  } catch (error) {
      return {
        data: localFallbackEmployees,
        mode: localCacheExists ? 'local-cache' : 'local-disabled',
        message: localCacheExists
          ? `${formatSupabaseError(error, 'Chargement de la base RH')} Donnees locales affichees; les changements recents en ligne peuvent manquer.`
          : formatSupabaseError(error, 'Chargement de la base RH'),
      };
  }
}

export async function saveEmployeeRecord(employee) {
  const normalized = normalizeEmployee(employee);
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    throw new Error(`${configIssue || 'Supabase indisponible.'} La fiche n a pas ete sauvegardee en ligne.`);
  }

  const row = mapEmployeeToRow(normalized);
  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .upsert(row, { onConflict: 'record_id' })
      .select()
      .single();

    if (error) {
      const supabaseMessage = formatSupabaseError(error, 'Sauvegarde employe');
      throw new Error(supabaseMessage);
    }

    const savedEmployee = {
      ...mapRowToEmployee(data),
      userLevel: normalized.userLevel,
    };
    await activateSavedEmployee(savedEmployee.recordId);
    const syncedSave = upsertEmployeeLocally(savedEmployee);

    return {
      employee: savedEmployee,
      employees: syncedSave.employees,
      mode: 'supabase',
      message: `Fiche de ${savedEmployee.fullName} sauvegardee dans Supabase.`,
    };
  } catch (error) {
    const supabaseMessage = error instanceof Error && error.message
      ? error.message
      : formatSupabaseError(error, 'Sauvegarde employe');
    throw new Error(`${supabaseMessage} La fiche n a pas ete confirmee dans la base en ligne.`);
  }
}

export async function syncEmployeesToSupabase(employeeList = localEmployeesSeed) {
  const normalizedEmployees = buildPreparedEmployeeList(employeeList, readLocalEmployees());
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

export async function replaceEmployeeDirectory(employeeList = []) {
  // A replacement must contain only the newly imported Excel records.
  const normalizedEmployees = buildPreparedEmployeeList(employeeList);
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    throw new Error(`${configIssue || 'Supabase indisponible.'} L import n a pas ete sauvegarde en ligne.`);
  }

  try {
    if (normalizedEmployees.length) {
      const rows = normalizedEmployees.map(mapEmployeeToRow);
      const { error } = await supabase.from(TABLE_NAME).upsert(rows, { onConflict: 'record_id' });

      if (error) {
        throw new Error(formatSupabaseError(error, 'Import base RH'));
      }
    }

    // Publish the new active set only after every imported row was accepted.
    await saveActiveDirectoryRecordIds(normalizedEmployees);
    writeDeletedRecordIds(new Set());
    writeLocalEmployees(normalizedEmployees);

    return {
      employees: normalizedEmployees,
      mode: 'supabase',
      message: normalizedEmployees.length
        ? `Base RH remplacee par ${normalizedEmployees.length} fiche(s) dans Supabase.`
        : 'Base RH videe dans Supabase.',
    };
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : formatSupabaseError(error, 'Import base RH');
    throw new Error(`${message} L ancienne base reste affichee; le nouvel import n a pas ete confirme en ligne.`);
  }
}

export async function clearEmployeeDirectory() {
  clearLocalEmployeesState();
  const configIssue = getSupabaseConfigIssue();

  if (!hasSupabaseEnv || !supabase) {
    return {
      employees: [],
      mode: 'local-disabled',
      message: `${configIssue || 'Supabase indisponible.'} La base RH locale du navigateur est maintenant vide.`,
    };
  }

  try {
    await saveActiveDirectoryRecordIds([]);

    try {
      await deleteAllRemoteEmployees();
    } catch {
      return {
        employees: [],
        mode: 'supabase',
        message: 'Base RH active videe.',
      };
    }

    return {
      employees: [],
      mode: 'supabase',
      message: 'Base RH videe dans Supabase.',
    };
  } catch (error) {
    throw new Error(formatSupabaseError(error, 'Vidage de la base RH'));
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

    await saveActiveDirectoryRecordIds(employees);

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
