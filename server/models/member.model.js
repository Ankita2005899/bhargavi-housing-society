const pool = require('../config/database');

async function findAll() {
  const { rows } = await pool.query('SELECT * FROM members ORDER BY created_at ASC');
  return rows;
}

async function count() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM members');
  return rows[0].count;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM members WHERE id = $1', [id]);
  return rows[0] || null;
}

// Safe, non-sensitive fields only — used for the public directory popup
// that any visitor (logged in or not) can browse.
async function findAllPublicSafe() {
  const { rows } = await pool.query(
    'SELECT id, name, wing, flat, profile_image, status FROM members ORDER BY wing ASC, flat ASC, name ASC'
  );
  return rows;
}

async function groupedByWingAndRoom() {
  const { rows } = await pool.query('SELECT * FROM members ORDER BY wing ASC, flat ASC, created_at ASC');
  const wings = {};
  rows.forEach(m => {
    wings[m.wing] = wings[m.wing] || {};
    wings[m.wing][m.flat] = wings[m.wing][m.flat] || [];
    wings[m.wing][m.flat].push(m);
  });
  return wings;
}

// Used during sign-up to link a resident's new account to a member
// record the Secretary already created (matched by name + wing + flat,
// case-insensitive) rather than creating a duplicate row.
async function findUnclaimedByNameWingFlat(name, wing, flat) {
  const { rows } = await pool.query(
    `SELECT m.* FROM members m
     LEFT JOIN users u ON u.member_id = m.id
     WHERE u.id IS NULL
       AND LOWER(m.name) = LOWER($1) AND m.wing = $2 AND LOWER(m.flat) = LOWER($3)
     LIMIT 1`,
    [name, wing, flat]
  );
  return rows[0] || null;
}

async function create(b) {
  const { rows } = await pool.query(
    `INSERT INTO members
      (name, wing, flat, phone, phone_2, email, address_1, address_2, aadhaar_number, occupation, business, profile_image, status, dues)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      b.name.trim(), b.wing, b.flat.trim(), b.phone.trim(), b.phone_2.trim(), b.email.trim(),
      b.address_1.trim(), b.address_2.trim(), String(b.aadhaar_number).replace(/\s+/g, ''),
      b.occupation.trim(), (b.business || '').trim(), (b.profile_image || '').trim(),
      b.status || 'Active', b.dues || 'Dues paid'
    ]
  );
  return rows[0];
}

// Minimal record created automatically when a resident signs up and no
// matching Secretary-created row exists yet — kept intentionally sparse;
// the Secretary can fill in the rest later from the dashboard.
async function createMinimal({ name, wing, flat, email }) {
  const { rows } = await pool.query(
    `INSERT INTO members (name, wing, flat, email, status, dues)
     VALUES ($1,$2,$3,$4,'Active','Dues pending') RETURNING *`,
    [name.trim(), wing, String(flat).trim(), email.trim()]
  );
  return rows[0];
}

async function update(id, b) {
  const { rows } = await pool.query(
    `UPDATE members SET
      name=$1, wing=$2, flat=$3, phone=$4, phone_2=$5, email=$6, address_1=$7, address_2=$8,
      aadhaar_number=$9, occupation=$10, business=$11, profile_image=$12, status=$13, dues=$14
     WHERE id=$15 RETURNING *`,
    [
      b.name.trim(), b.wing, b.flat.trim(), b.phone.trim(), b.phone_2.trim(), b.email.trim(),
      b.address_1.trim(), b.address_2.trim(), String(b.aadhaar_number).replace(/\s+/g, ''),
      b.occupation.trim(), (b.business || '').trim(), (b.profile_image || '').trim(),
      b.status || 'Active', b.dues || 'Dues paid', id
    ]
  );
  return rows[0] || null;
}

async function remove(id) {
  const { rows } = await pool.query('DELETE FROM members WHERE id=$1 RETURNING id', [id]);
  return rows[0] || null;
}

module.exports = {
  findAll, count, findById, findAllPublicSafe, groupedByWingAndRoom,
  findUnclaimedByNameWingFlat, create, createMinimal, update, remove
};
