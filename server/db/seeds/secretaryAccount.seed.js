// Creates the one Secretary login account the first time the server ever
// boots against a fresh database. After that it's a no-op — change the
// password afterwards from inside the app, not by editing env vars,
// since env vars are only read on this first run.

const pool = require('../../config/database');
const env = require('../../config/env');
const ROLES = require('../../constants/roles');
const { hashPassword } = require('../../utils/password');

async function seedSecretaryAccountIfMissing() {
  const email = env.secretaryEmail.toLowerCase();
  const { rows } = await pool.query('SELECT id, role FROM users WHERE email = $1', [email]);

  if (rows.length > 0) {
    // Account already exists (e.g. from an earlier deploy) — just make
    // sure it carries the Secretary role. Its password is left as-is,
    // so a password changed later from inside the app isn't overwritten
    // on every restart.
    if (rows[0].role !== ROLES.SECRETARY) {
      await pool.query('UPDATE users SET role = $1 WHERE id = $2', [ROLES.SECRETARY, rows[0].id]);
      console.log(`✅ Secretary role granted to existing account (${email})`);
    }
    return;
  }

  const passwordHash = await hashPassword(env.secretaryPassword);
  await pool.query(
    `INSERT INTO users (email, password_hash, role, member_id) VALUES ($1,$2,$3,NULL)`,
    [email, passwordHash, ROLES.SECRETARY]
  );
  console.log(`✅ Secretary account ready (${email}) — sign in from the Login page.`);
}

module.exports = seedSecretaryAccountIfMissing;
