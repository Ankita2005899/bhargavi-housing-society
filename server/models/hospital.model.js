const pool = require('../config/database');

async function findAll() {
  const { rows } = await pool.query('SELECT * FROM hospitals ORDER BY created_at ASC');
  return rows;
}
async function findAllPublic() {
  const { rows } = await pool.query('SELECT id, name, address, phone_main, phone_staff, notes FROM hospitals ORDER BY created_at ASC');
  return rows;
}
async function create({ name, address, phone_main, phone_staff, notes }) {
  const { rows } = await pool.query(
    `INSERT INTO hospitals (name, address, phone_main, phone_staff, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, address, phone_main || '', phone_staff || '', notes || '']
  );
  return rows[0];
}
async function update(id, { name, address, phone_main, phone_staff, notes }) {
  const { rows } = await pool.query(
    `UPDATE hospitals SET name=$1, address=$2, phone_main=$3, phone_staff=$4, notes=$5 WHERE id=$6 RETURNING *`,
    [name, address, phone_main || '', phone_staff || '', notes || '', id]
  );
  return rows[0] || null;
}
async function remove(id) {
  const { rows } = await pool.query('DELETE FROM hospitals WHERE id=$1 RETURNING id', [id]);
  return rows[0] || null;
}
module.exports = { findAll, findAllPublic, create, update, remove };
