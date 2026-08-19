const pool = require('../config/database');

async function findByMonth(month) {
  const { rows } = await pool.query(
    `SELECT m.id AS member_id, m.name, m.wing, m.flat, m.profile_image,
            COALESCE(mp.amount, 0) AS amount,
            COALESCE(mp.status, 'Unpaid') AS status,
            mp.screenshot
     FROM members m
     LEFT JOIN maintenance_payments mp ON mp.member_id = m.id AND mp.month = $1
     ORDER BY m.wing ASC, m.flat ASC, m.name ASC`,
    [month]
  );
  return rows;
}
async function upsert({ member_id, month, amount, status, screenshot }) {
  const { rows } = await pool.query(
    `INSERT INTO maintenance_payments (member_id, month, amount, status, screenshot, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (member_id, month)
     DO UPDATE SET amount=$3, status=$4, screenshot=$5, updated_at=now()
     RETURNING *`,
    [member_id, month, Number(amount) || 0, status === 'Paid' ? 'Paid' : 'Unpaid', screenshot || null]
  );
  return rows[0];
}
module.exports = { findByMonth, upsert };
