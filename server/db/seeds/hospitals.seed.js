const pool = require('../../config/database');

async function seedDemoHospitalsIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM hospitals');
  if (rows[0].count > 0) return;
  const entries = [
    ['Sunrise Multispeciality Hospital', 'Near Society Main Gate, MG Road', '022-49001100', '9820011223', '5 min away, 24x7 emergency'],
    ['City Care Hospital', 'Station Road, opposite bus depot', '022-49002200', '9820044556', 'Has ICU and cardiac unit'],
    ['Apex Trauma Centre', 'Highway junction, 2 km from society', '022-49003300', '9820077889', 'Best for accident/trauma cases'],
    ['Wellness Women & Child Hospital', 'Behind central market', '022-49004400', '9820099001', 'Maternity and pediatric care'],
    ['Lifeline Diagnostics & Hospital', 'Near railway station', '022-49005500', '9820033445', 'Good for lab tests and diagnostics']
  ];
  for (const [name, address, phone_main, phone_staff, notes] of entries) {
    await pool.query(
      `INSERT INTO hospitals (name, address, phone_main, phone_staff, notes) VALUES ($1,$2,$3,$4,$5)`,
      [name, address, phone_main, phone_staff, notes]
    );
  }
  console.log(`✅ Seeded ${entries.length} demo hospitals`);
}

module.exports = seedDemoHospitalsIfEmpty;
