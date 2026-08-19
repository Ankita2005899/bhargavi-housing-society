// One-time demo data: 3 wings x 5 rooms x 5 members, so the Members
// section isn't empty on first use. Only runs if the members table has
// zero rows — safe to leave in place permanently, it never overwrites
// or duplicates real data added afterwards.
const pool = require('../../config/database');

async function seedDemoMembersIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM members');
  if (rows[0].count > 0) return;
  const wings = ['Wing A', 'Wing B', 'Wing C'];
  const rooms = ['101', '102', '103', '104', '105'];
  const occupations = ['Service', 'Business', 'Retired', 'Homemaker', 'Self-employed'];
  let serial = 1;
  const values = [];
  const params = [];
  let p = 1;
  for (const wing of wings) {
    for (const room of rooms) {
      for (let i = 1; i <= 5; i++) {
        const aadhaar = String(100000000000 + serial).slice(-12);
        const phone = '90000' + String(10000 + serial).slice(-5);
        const phone2 = '90001' + String(10000 + serial).slice(-5);
        params.push(
          `Member ${serial} (${wing}, ${room})`, wing, room,
          phone, phone2, `member${serial}@example.com`,
          `Flat ${room}, ${wing}, Bhargavi Housing Society`, `Flat ${room}, ${wing}, Bhargavi Housing Society`,
          aadhaar, occupations[i % occupations.length], '', '',
          i === 1 ? 'Active' : 'Active', serial % 4 === 0 ? 'Dues pending' : 'Dues paid'
        );
        const placeholders = Array.from({ length: 14 }, () => `$${p++}`).join(',');
        values.push(`(${placeholders})`);
        serial++;
      }
    }
  }
  await pool.query(
    `INSERT INTO members
      (name, wing, flat, phone, phone_2, email, address_1, address_2, aadhaar_number, occupation, business, profile_image, status, dues)
     VALUES ${values.join(',')}`,
    params
  );
  console.log(`✅ Seeded ${serial - 1} demo members (3 wings × 5 rooms × 5 members)`);
}

module.exports = seedDemoMembersIfEmpty;
