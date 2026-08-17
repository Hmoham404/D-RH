import { defaultHrData } from '../defaultHrData';

function normalizePayType(value) {
  const text = (value || '').trim().toLowerCase();
  if (text === 'horaire') return 'Horaire';
  if (text === 'mensuel') return 'Mensuel';
  return 'Non renseigne';
}

function isSigned(value) {
  return value === 'Oui' || value === 'Oui/E';
}

function groupByCount(items, getKey, formatLabel) {
  const counts = new Map();

  items.forEach((item) => {
    const key = (getKey(item) || '').trim();
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...counts.entries()]
    .map(([key, value]) => ({
      label: formatLabel ? formatLabel(key) : key,
      value,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function capitalizeWords(value) {
  return value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function parseFrenchDate(value) {
  if (!value || !/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return null;
  const [day, month, year] = value.split('/').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getRecentHires(employees) {
  return [...employees]
    .filter((employee) => parseFrenchDate(employee.hiredAt))
    .sort((a, b) => parseFrenchDate(b.hiredAt) - parseFrenchDate(a.hiredAt))
    .slice(0, 6)
    .map((employee) => ({
      lastName: employee.lastName,
      firstName: employee.firstName,
      date: employee.hiredAt,
      department: employee.department,
      service: employee.service,
      contract: employee.contract,
    }));
}

export function buildDashboardData(baseData = defaultHrData, employees = []) {
  const allEmployees = Array.isArray(employees) ? employees : [];
  const activeEmployees = allEmployees.filter((employee) => employee.status === 'Actif');
  const signedContracts = allEmployees.filter((employee) => isSigned(employee.signed)).length;

  const alertsSource = baseData.alerts?.length ? baseData.alerts : defaultHrData.alerts;

  return {
    ...baseData,
    totals: {
      employees: allEmployees.length,
      active: activeEmployees.length,
      stc: allEmployees.filter((employee) => employee.status === 'STC').length,
      signedContracts,
      unsignedContracts: allEmployees.length - signedContracts,
    },
    activeMix: {
      moi: activeEmployees.filter((employee) => employee.kind === 'MOI').length,
      mod: activeEmployees.filter((employee) => employee.kind === 'MOD').length,
      women: activeEmployees.filter((employee) => employee.gender === 'F').length,
      men: activeEmployees.filter((employee) => employee.gender === 'H').length,
    },
    alerts: alertsSource.map((alert) => {
      if (alert.label === 'Actifs sans contrat signe') {
        return {
          ...alert,
          value: activeEmployees.filter((employee) => !isSigned(employee.signed)).length,
        };
      }

      if (alert.label === 'Actifs sans type de paie') {
        return {
          ...alert,
          value: activeEmployees.filter((employee) => normalizePayType(employee.payType) === 'Non renseigne').length,
        };
      }

      if (alert.label === 'Fiches sans matricule final') {
        return {
          ...alert,
          value: allEmployees.filter((employee) => !employee.finalCode).length,
        };
      }

      return alert;
    }),
    activeDepartments: groupByCount(
      activeEmployees,
      (employee) => employee.department,
      capitalizeWords,
    ),
    activeServices: groupByCount(activeEmployees, (employee) => employee.service),
    contracts: groupByCount(activeEmployees, (employee) => employee.contract),
    payTypes: groupByCount(activeEmployees, (employee) => normalizePayType(employee.payType)),
    recentHires: getRecentHires(allEmployees),
  };
}

export { isSigned, normalizePayType };
