const pool = require('../../config/database');

async function seedDemoAmbulancesIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM ambulances');
  if (rows[0].count > 0) return;
  const entries = [
    ['Sunrise Hospital Ambulance', '9820011223', 8, 'ICU-equipped, comes directly from Sunrise Hospital'],
    ['City Care Ambulance Service', '9820044556', 12, 'Basic life support'],
    ['108 Government Ambulance', '108', 15, 'Free government service'],
    ['Apex Trauma Ambulance', '9820077889', 10, 'Best for accident/trauma cases'],
    ['Private Ambulance — Shree Sai Seva', '9820066778', 20, 'Available 24x7, advance booking possible']
  ];
  for (const [service_name, phone, eta_minutes, notes] of entries) {
    await pool.query(
      `INSERT INTO ambulances (service_name, phone, eta_minutes, notes) VALUES ($1,$2,$3,$4)`,
      [service_name, phone, eta_minutes, notes]
    );
  }
  console.log(`✅ Seeded ${entries.length} demo ambulance services`);
}

module.exports = seedDemoAmbulancesIfEmpty;
