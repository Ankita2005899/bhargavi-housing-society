const pool = require('../config/database');

async function findAll() {
  const { rows } = await pool.query('SELECT * FROM staff ORDER BY created_at ASC');
  return rows;
}
async function create({ name, role, phone, address, id_proof, profile_image, notes, status }) {
  const { rows } = await pool.query(
    `INSERT INTO staff (name, role, phone, address, id_proof, profile_image, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [name, role || 'Other', phone, address || '', id_proof || '', profile_image || '', notes || '', status || 'Active']
  );
  return rows[0];
}
async function update(id, { name, role, phone, address, id_proof, profile_image, notes, status }) {
  const { rows } = await pool.query(
    `UPDATE staff SET name=$1, role=$2, phone=$3, address=$4, id_proof=$5, profile_image=$6, notes=$7, status=$8
     WHERE id=$9 RETURNING *`,
    [name, role || 'Other', phone, address || '', id_proof || '', profile_image || '', notes || '', status || 'Active', id]
  );
  return rows[0] || null;
}
async function remove(id) {
  const { rows } = await pool.query('DELETE FROM staff WHERE id=$1 RETURNING id', [id]);
  return rows[0] || null;
}
module.exports = { findAll, create, update, remove };
