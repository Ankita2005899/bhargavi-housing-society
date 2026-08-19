const pool = require('../config/database');

async function findByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [String(email).toLowerCase().trim()]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function create({ email, passwordHash, role, memberId }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, member_id) VALUES ($1,$2,$3,$4) RETURNING *`,
    [String(email).toLowerCase().trim(), passwordHash, role, memberId || null]
  );
  return rows[0];
}

module.exports = { findByEmail, findById, create };
