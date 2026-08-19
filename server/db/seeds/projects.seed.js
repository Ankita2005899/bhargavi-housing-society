const pool = require('../../config/database');

async function seedDemoProjectsIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM projects');
  if (rows[0].count > 0) return;
  const entries = [
    ['Rainwater harvesting setup', 'Secretary — Mr. Kulkarni', 'Ongoing', 250000, 140000],
    ['CCTV upgrade — all wings', 'Treasurer — Mrs. Deshmukh', 'Completed', 180000, 175000],
    ['Clubhouse renovation', 'Committee member — Mr. Rao', 'Planned', 500000, 0],
    ['Garden landscaping', 'Secretary — Mr. Kulkarni', 'Ongoing', 90000, 42000],
    ['Solar panels for common lighting', 'Treasurer — Mrs. Deshmukh', 'Planned', 320000, 0]
  ];
  for (const [title, owner, status, budget, spent] of entries) {
    await pool.query(
      `INSERT INTO projects (title, owner, status, budget, spent) VALUES ($1,$2,$3,$4,$5)`,
      [title, owner, status, budget, spent]
    );
  }
  console.log(`✅ Seeded ${entries.length} demo projects`);
}

module.exports = seedDemoProjectsIfEmpty;
