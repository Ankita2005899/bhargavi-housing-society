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

// Called on every successful login: bumps the running count, stamps the
// time, and adds a row to login_history so the Secretary section has a
// full log of every entry, not just the latest one.
async function recordLogin(id) {
  const { rows } = await pool.query(
    `UPDATE users SET login_count = login_count + 1, last_login_at = now()
     WHERE id = $1 RETURNING login_count, last_login_at`,
    [id]
  );
  await pool.query('INSERT INTO login_history (user_id) VALUES ($1)', [id]);
  return rows[0];
}

// Secretary-only: every registered account (resident or secretary) with
// its linked member details and login stats — this is the "Accounts"
// list inside the Secretary section.
async function findAllWithStats() {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role, u.login_count, u.last_login_at, u.created_at,
            m.name AS member_name, m.wing, m.flat
     FROM users u
     LEFT JOIN members m ON m.id = u.member_id
     ORDER BY u.created_at ASC`
  );
  return rows;
}

// Secretary-only: the raw login log (time of every entry), newest first.
async function findLoginHistory(limit) {
  const { rows } = await pool.query(
    `SELECT lh.id, lh.logged_in_at, u.email, u.role, m.name AS member_name, m.wing, m.flat
     FROM login_history lh
     JOIN users u ON u.id = lh.user_id
     LEFT JOIN members m ON m.id = u.member_id
     ORDER BY lh.logged_in_at DESC
     LIMIT $1`,
    [limit || 200]
  );
  return rows;
}

// Secretary-only: permanently remove an account (and its login history,
// via the FK cascade) from the Accounts list.
async function deleteById(id) {
  const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
  return rows[0] || null;
}

module.exports = { findByEmail, findById, create, recordLogin, findAllWithStats, findLoginHistory, deleteById };
