const pool = require('../config/database');

async function findAll() {
  const { rows } = await pool.query('SELECT * FROM ambulances ORDER BY eta_minutes ASC, created_at ASC');
  return rows;
}
async function findAllPublic() {
  const { rows } = await pool.query('SELECT id, service_name, phone, eta_minutes, notes FROM ambulances ORDER BY eta_minutes ASC, created_at ASC');
  return rows;
}
async function create({ service_name, phone, eta_minutes, notes }) {
  const { rows } = await pool.query(
    `INSERT INTO ambulances (service_name, phone, eta_minutes, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
    [service_name, phone, Number(eta_minutes) || 0, notes || '']
  );
  return rows[0];
}
async function update(id, { service_name, phone, eta_minutes, notes }) {
  const { rows } = await pool.query(
    `UPDATE ambulances SET service_name=$1, phone=$2, eta_minutes=$3, notes=$4 WHERE id=$5 RETURNING *`,
    [service_name, phone, Number(eta_minutes) || 0, notes || '', id]
  );
  return rows[0] || null;
}
async function remove(id) {
  const { rows } = await pool.query('DELETE FROM ambulances WHERE id=$1 RETURNING id', [id]);
  return rows[0] || null;
}
module.exports = { findAll, findAllPublic, create, update, remove };
