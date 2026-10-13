// Lossless storage of a nested view that is an exact projection of its parent.
// The root retains every source punch and remains validated by the SQL guard.
// Distinct nested views keep their original representation and SQL validation.
const MARKER = 'currentFilePointageParentFields';

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function expandPointageStorage(snapshot) {
  if (!snapshot || !Object.prototype.hasOwnProperty.call(snapshot, MARKER)) return snapshot;
  const { [MARKER]: fields, ...expanded } = snapshot;
  if (snapshot.currentFilePointage !== null || !Array.isArray(fields) || !fields.length
    || fields.some((key) => typeof key !== 'string' || key === MARKER || key === 'currentFilePointage'
      || !Object.prototype.hasOwnProperty.call(expanded, key))) {
    throw new Error('Format de stockage du pointage invalide.');
  }
  expanded.currentFilePointage = Object.fromEntries(fields.map((key) => [key, expanded[key]]));
  return expanded;
}

export function compactPointageStorage(snapshot) {
  const expanded = expandPointageStorage(snapshot);
  const current = expanded?.currentFilePointage;
  if (!current || typeof current !== 'object' || Array.isArray(current)) return expanded;
  const fields = Object.keys(current);
  if (!fields.length || fields.some((key) => key === MARKER || key === 'currentFilePointage'
    || !Object.prototype.hasOwnProperty.call(expanded, key)
    || stableJson(current[key]) !== stableJson(expanded[key]))) return expanded;
  return { ...expanded, currentFilePointage: null, [MARKER]: fields };
}
