const pool = require('../../config/database');

async function seedDemoStaffIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM staff');
  if (rows[0].count > 0) return;
  const entries = [
    ['Ramesh Yadav', 'Security Guard', '9821012345', 'Society main gate', '', 'Active', 'Day shift, 8 AM – 8 PM'],
    ['Suresh Patil', 'Plumber', '9821023456', 'Local — visits on call', '', 'Active', 'Regular plumbing contractor'],
    ['Ganesh Electricals', 'Electrician', '9821034567', 'Nearby market area', '', 'Active', 'Handles common area wiring'],
    ['Lakshmi Bai', 'Vegetable Vendor', '9821045678', 'Comes daily to society gate', '', 'Active', 'Visits every morning ~7 AM'],
    ['Anna Water Supply', 'Water Supplier (Pani Wala)', '9821056789', 'Local water tanker service', '', 'Active', 'Backup water supply on request']
  ];
  for (const [name, role, phone, address, id_proof, status, notes] of entries) {
    await pool.query(
      `INSERT INTO staff (name, role, phone, address, id_proof, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [name, role, phone, address, id_proof, status, notes]
    );
  }
  console.log(`✅ Seeded ${entries.length} demo staff/vendor entries`);
}

module.exports = seedDemoStaffIfEmpty;
