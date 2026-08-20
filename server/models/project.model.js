const pool = require('../config/database');

async function findAll() {
  const { rows } = await pool.query('SELECT * FROM projects ORDER BY created_at ASC');
  return rows;
}
async function create({ title, owner, status, budget, spent }) {
  const { rows } = await pool.query(
    `INSERT INTO projects (title, owner, status, budget, spent) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [title, owner || '', status || 'Planned', budget || 0, spent || 0]
  );
  return rows[0];
}
async function update(id, { title, owner, status, budget, spent }) {
  const { rows } = await pool.query(
    `UPDATE projects SET title=$1, owner=$2, status=$3, budget=$4, spent=$5 WHERE id=$6 RETURNING *`,
    [title, owner || '', status || 'Planned', budget || 0, spent || 0, id]
  );
  return rows[0] || null;
}
async function remove(id) {
  const { rows } = await pool.query('DELETE FROM projects WHERE id=$1 RETURNING id', [id]);
  return rows[0] || null;
}
module.exports = { findAll, create, update, remove };
