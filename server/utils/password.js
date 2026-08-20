// Thin wrapper around bcryptjs (pure-JS, no native build step — safe on
// Render's default Node build image) so the rest of the app never touches
// the hashing library directly.

const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

async function hashPassword(plainText) {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

async function verifyPassword(plainText, hash) {
  if (!hash) return false;
  return bcrypt.compare(plainText, hash);
}

module.exports = { hashPassword, verifyPassword };
