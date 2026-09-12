export function exportCsv(rows, columns = ['name', 'email']) {
  const fields = Object.keys(rows[0]);
  return [fields.join(','), ...rows.map(row => fields.map(field => row[field] ?? '').join(','))].join('\n');
}
