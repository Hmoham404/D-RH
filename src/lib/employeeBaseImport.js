import * as XLSX from 'xlsx/xlsx.mjs';
import { cleanInactiveFrom, hasMeaningfulEmployeeData } from './employeeValidation.js';

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeHeader(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasRowContent(row = []) {
  return row.some((cell) => cleanText(cell));
}

function headerMatchesAlias(header, alias) {
  if (!header || !alias) {
    return false;
  }

  return header === alias || (alias.length >= 5 && header.includes(alias));
}

const FIRST_NAME_ALIASES = ['prenom', 'first name', 'given name'];
const FIELD_ALIASES = {
  finalCode: [
    'code',
    'code employe',
    'code employee',
    'code final',
    'final code',
    'code base',
    'code de base',
    'code rh',
    'matr final',
    'matricule final',
  ],
  id: ['matricule', 'matricule interne', 'matricule paie', 'matr', 'id', 'identifiant', 'numero', 'n'],
  zk: ['zk', 'matr zk', 'id zk', 'badge', 'matricule zk', 'code badge', 'pointeuse', 'pointeur'],
  saber: ['saber', 'matr saber', 'code saber', 'matricule saber'],
  fullName: ['nom complet', 'employee', 'employe', 'nom et prenom', 'prenom et nom', 'full name'],
  lastName: ['nom', 'last name', 'surname', 'nom de famille'],
  firstName: FIRST_NAME_ALIASES,
  gender: ['genre', 'sexe', 'sex', 'gender'],
  kind: ['categorie', 'categorie pro', 'category', 'type employe', 'type employe e', 'kind', 'moi mod'],
  contract: ['contrat', 'type contrat', 'type de cont', 'contrat travail', 'contract'],
  department: ['departement', 'depart', 'dept', 'department', 'direction'],
  service: ['service', 'service atelier', 'atelier', 'unite'],
  job: ['poste', 'poste travail', 'fonction', 'job'],
  hiredAt: ['date embauche', 'date d embauche', 'date entree', 'embauche', 'hired at', 'entry date'],
  payType: ['type paie', 'type paye', 'mode paie', 'paie', 'pay type'],
  signed: ['contrat signe', 'signe', 'signature', 'signed'],
  status: ['statut', 'status', 'situation', 'etat', 'actif inactif'],
  inactiveFrom: ['inactif depuis', 'inactif a partir', 'inactif a part', 'inactive from', 'sortie', 'mois sortie', 'date sortie'],
};

function resolveFieldFromHeader(header, hasFirstNameColumn) {
  if (!header) {
    return '';
  }

  if (!hasFirstNameColumn && header === 'nom') {
    return 'fullName';
  }

  // Prefer exact matches so "Contrat signe" cannot become "Contrat".
  const exactField = Object.entries(FIELD_ALIASES)
    .find(([, aliases]) => aliases.includes(header))?.[0];
  if (exactField) {
    return exactField;
  }

  if (FIELD_ALIASES.fullName.some((alias) => headerMatchesAlias(header, alias))) {
    return 'fullName';
  }

  if (FIELD_ALIASES.lastName.some((alias) => headerMatchesAlias(header, alias))) {
    return 'lastName';
  }

  return Object.entries(FIELD_ALIASES).find(([field, aliases]) => {
    if (field === 'fullName' || field === 'lastName') {
      return false;
    }

    return aliases.some((alias) => headerMatchesAlias(header, alias));
  })?.[0] || '';
}

function buildHeaderMapping(row) {
  const headers = row.map((cell) => normalizeHeader(cell));
  const hasFirstNameColumn = headers.some((header) =>
    FIRST_NAME_ALIASES.some((alias) => headerMatchesAlias(header, alias)),
  );
  const mapping = new Map();

  headers.forEach((header, index) => {
    const field = resolveFieldFromHeader(header, hasFirstNameColumn);
    if (field && (!mapping.has(field) || (field === 'kind' && header === 'moi mod'))) {
      mapping.set(field, index);
    }
  });

  const score = mapping.size;
  const hasIdentityField =
    mapping.has('fullName') || mapping.has('lastName') || mapping.has('finalCode') || mapping.has('id');

  return {
    headers,
    mapping,
    score,
    hasIdentityField,
  };
}

function findBestSheet(workbook) {
  const candidates = workbook.SheetNames.map((sheetName) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
      dateNF: 'dd/mm/yyyy',
    });
    let bestHeader = null;

    rows.slice(0, 25).forEach((row, rowIndex) => {
      if (!hasRowContent(row)) {
        return;
      }

      const candidate = buildHeaderMapping(row);
      if (!candidate.hasIdentityField || candidate.score < 3) {
        return;
      }

      if (!bestHeader || candidate.score > bestHeader.score) {
        bestHeader = { ...candidate, rowIndex };
      }
    });

    if (!bestHeader) {
      return null;
    }

    const dataRows = rows.slice(bestHeader.rowIndex + 1).filter(hasRowContent);

    return {
      sheetName,
      rows,
      dataRows,
      ...bestHeader,
    };
  }).filter(Boolean);

  return candidates.sort((left, right) => {
    const scoreSort = right.score - left.score;
    if (scoreSort !== 0) {
      return scoreSort;
    }

    return right.dataRows.length - left.dataRows.length;
  })[0] || null;
}

function getMappedValue(row, mapping, field) {
  const columnIndex = mapping.get(field);
  return columnIndex === undefined ? '' : cleanText(row[columnIndex]);
}

function normalizeStatus(value, inactiveFrom) {
  const normalized = normalizeHeader(value);

  if (!normalized) {
    return inactiveFrom ? 'STC' : 'Actif';
  }

  if (
    normalized === 'actif' ||
    normalized === 'active' ||
    normalized === 'en poste' ||
    normalized === 'present'
  ) {
    return 'Actif';
  }

  if (
    normalized === 'stc' ||
    normalized === 'sorti' ||
    normalized === 'sortie' ||
    normalized === 'inactif' ||
    normalized === 'inactive'
  ) {
    return 'STC';
  }

  return cleanText(value);
}

function buildEmployeeFromRow(row, mapping) {
  const lastName = getMappedValue(row, mapping, 'lastName');
  const firstName = getMappedValue(row, mapping, 'firstName');
  const fullName = getMappedValue(row, mapping, 'fullName') || `${lastName} ${firstName}`.trim();
  const inactiveFrom = cleanInactiveFrom(getMappedValue(row, mapping, 'inactiveFrom'));
  const id = getMappedValue(row, mapping, 'id');
  const zk = getMappedValue(row, mapping, 'zk');
  const saber = getMappedValue(row, mapping, 'saber');
  // A matricule is the best available employee code when the sheet has no separate code column.
  const finalCode = getMappedValue(row, mapping, 'finalCode') || id || zk || saber;

  return {
    id,
    zk,
    saber,
    finalCode,
    fullName,
    lastName,
    firstName,
    gender: getMappedValue(row, mapping, 'gender'),
    kind: getMappedValue(row, mapping, 'kind'),
    contract: getMappedValue(row, mapping, 'contract'),
    department: getMappedValue(row, mapping, 'department'),
    service: getMappedValue(row, mapping, 'service'),
    job: getMappedValue(row, mapping, 'job'),
    hiredAt: getMappedValue(row, mapping, 'hiredAt'),
    payType: getMappedValue(row, mapping, 'payType'),
    signed: getMappedValue(row, mapping, 'signed'),
    status: normalizeStatus(getMappedValue(row, mapping, 'status'), inactiveFrom),
    inactiveFrom,
  };
}

export async function analyzeEmployeeBaseFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });

  if (!workbook.SheetNames.length) {
    throw new Error('Le fichier Excel RH ne contient aucune feuille.');
  }

  const selectedSheet = findBestSheet(workbook);

  if (!selectedSheet) {
    throw new Error(
      'Les colonnes RH sont introuvables. Le fichier doit contenir au moins nom, code ou matricule, plus departement ou service.',
    );
  }

  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[selectedSheet.sheetName], {
    header: 1, defval: '', raw: true,
  });
  const hiredAtColumn = selectedSheet.mapping.get('hiredAt');
  const employees = selectedSheet.rows.slice(selectedSheet.rowIndex + 1)
    .map((row, index) => {
      const employee = buildEmployeeFromRow(row, selectedSheet.mapping);
      const rawHireDate = rawRows[selectedSheet.rowIndex + 1 + index]?.[hiredAtColumn];
      // Excel stores dates as serial numbers; ignore the cell's display format.
      if (typeof rawHireDate === 'number') {
        const date = rawHireDate > 0 ? XLSX.SSF.parse_date_code(rawHireDate, {
          date1904: Boolean(workbook.Workbook?.WBProps?.date1904),
        }) : null;
        employee.hiredAt = date
          ? `${String(date.d).padStart(2, '0')}/${String(date.m).padStart(2, '0')}/${date.y}`
          : '';
      }
      return employee;
    })
    .filter(hasMeaningfulEmployeeData);

  if (!employees.length) {
    throw new Error('Le fichier Excel RH est vide ou aucune fiche exploitable n a ete detectee.');
  }

  return {
    employees,
    fileName: file.name || '',
    sheetName: selectedSheet.sheetName,
    headerRowNumber: selectedSheet.rowIndex + 1,
  };
}
