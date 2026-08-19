// Creates the one Secretary login account the first time the server ever
// boots against a fresh database. After that it's a no-op — change the
// password afterwards from inside the app, not by editing env vars,
// since env vars are only read on this first run.

const pool = require('../../config/database');
const env = require('../../config/env');
const ROLES = require('../../constants/roles');
const { hashPassword } = require('../../utils/password');

async function seedSecretaryAccountIfMissing() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE role = $1', [ROLES.SECRETARY]);
  if (rows[0].count > 0) return;
  const passwordHash = await hashPassword(env.secretaryPassword);
  await pool.query(
    `INSERT INTO users (email, password_hash, role, member_id) VALUES ($1,$2,$3,NULL)`,
    [env.secretaryEmail.toLowerCase(), passwordHash, ROLES.SECRETARY]
  );
  console.log(`✅ Secretary account ready (${env.secretaryEmail}) — sign in from the Login page.`);
}

module.exports = seedSecretaryAccountIfMissing;
