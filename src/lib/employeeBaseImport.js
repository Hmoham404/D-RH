import * as XLSX from 'xlsx';

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
  payType: ['type paie', 'mode paie', 'paie', 'pay type'],
  signed: ['contrat signe', 'signe', 'signature', 'signed'],
  status: ['statut', 'status', 'situation', 'etat'],
  inactiveFrom: ['inactif depuis', 'inactive from', 'sortie', 'mois sortie', 'date sortie'],
};

function resolveFieldFromHeader(header, hasFirstNameColumn) {
  if (!header) {
    return '';
  }

  if (FIELD_ALIASES.fullName.some((alias) => headerMatchesAlias(header, alias))) {
    return 'fullName';
  }

  if (!hasFirstNameColumn && header === 'nom') {
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
    if (field && !mapping.has(field)) {
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
  const inactiveFrom = getMappedValue(row, mapping, 'inactiveFrom');
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

function hasMeaningfulEmployeeData(employee) {
  const values = [
    employee.finalCode,
    employee.id,
    employee.zk,
    employee.saber,
    employee.fullName,
    employee.lastName,
    employee.firstName,
    employee.department,
    employee.service,
    employee.job,
  ].map((value) => cleanText(value));

  const hasRealValue = values.some((value) => !['', '-', '0', 'o', 'n/a'].includes(value.toLowerCase()));
  const nameTokens = cleanText(employee.fullName)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const hasRealName = nameTokens.some((token) => !['-', '0', 'o', 'n/a'].includes(token));

  return hasRealValue && (hasRealName || Boolean(cleanText(employee.finalCode || employee.id || employee.zk || employee.saber)));
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

  const employees = selectedSheet.dataRows
    .map((row) => buildEmployeeFromRow(row, selectedSheet.mapping))
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
