export function getLocalPointageDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function getDefaultPointageDate(dates, today = getLocalPointageDate()) {
  const sorted = [...new Set(dates)].filter(Boolean).sort();
  return sorted.includes(today) ? today : sorted.at(-1) || '';
}
