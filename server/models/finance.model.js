const pool = require('../config/database');

async function findAll() {
  const { rows } = await pool.query('SELECT * FROM finance ORDER BY entry_date DESC NULLS LAST, created_at DESC');
  return rows;
}
async function create({ description, category, type, amount, entry_date }) {
  const { rows } = await pool.query(
    `INSERT INTO finance (description, category, type, amount, entry_date) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [description, category || 'Other', type || 'Expense', amount, entry_date || null]
  );
  return rows[0];
}
async function update(id, { description, category, type, amount, entry_date }) {
  const { rows } = await pool.query(
    `UPDATE finance SET description=$1, category=$2, type=$3, amount=$4, entry_date=$5 WHERE id=$6 RETURNING *`,
    [description, category || 'Other', type || 'Expense', amount, entry_date || null, id]
  );
  return rows[0] || null;
}
async function remove(id) {
  const { rows } = await pool.query('DELETE FROM finance WHERE id=$1 RETURNING id', [id]);
  return rows[0] || null;
}
module.exports = { findAll, create, update, remove };
