export const customers = [
  { name: 'Ada Chen', email: 'ada@acme.example', company: 'Acme Studio', status: 'Active', revenue: 950 },
  { name: 'Marcus Rivera', email: 'marcus@bloom.example', company: 'Bloom & Co', status: 'Active', revenue: 1200 },
  { name: 'Priya Shah', email: 'priya@layers.example', company: 'Layers', status: 'Trial', revenue: 0 },
  { name: 'Oliver Park', email: 'oliver@oak.example', company: 'Oak Workshop', status: 'Active', revenue: 450 },
  { name: 'Sofia Martin', email: 'sofia@kinfolk.example', company: 'Kinfolk', status: 'Active', revenue: 800 },
  { name: 'James Wilson', email: 'james@pencil.example', company: 'Pencil', status: 'Trial', revenue: 0 },
  { name: 'Amara Okafor', email: 'amara@daylight.example', company: 'Daylight', status: 'Active', revenue: 850 },
  { name: 'Leo Tan', email: 'leo@form.example', company: 'Form Works', status: 'Trial', revenue: 0 },
];

export function filterCustomers(rows, query, status) {
  const search = query.trim().toLowerCase();
  return rows.filter(row => (status === 'all' || row.status === status) &&
    [row.name, row.email, row.company].some(value => value.toLowerCase().includes(search)));
}
