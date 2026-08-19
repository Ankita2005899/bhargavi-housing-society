// Single shared Postgres (Neon) connection pool. Every model imports the
// pool from here rather than creating its own — one connection pool per
// process is all that's needed.

const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseUrl && env.databaseUrl.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

module.exports = pool;
