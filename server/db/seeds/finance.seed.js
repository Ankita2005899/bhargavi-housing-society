const pool = require('../../config/database');

async function seedDemoFinanceIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM finance');
  if (rows[0].count > 0) return;
  const entries = [
    ['Maintenance collection — Q1', 'Maintenance', 'Income', 185000, '2026-04-05'],
    ['Diwali function expenses', 'Events', 'Expense', 32000, '2026-05-12'],
    ['Lift repair — Wing B', 'Repairs', 'Expense', 18500, '2026-06-02'],
    ['Water bill — society borewell', 'Utilities', 'Expense', 9200, '2026-06-20'],
    ['Security agency payment — June', 'Security', 'Expense', 45000, '2026-06-28']
  ];
  for (const [description, category, type, amount, entry_date] of entries) {
    await pool.query(
      `INSERT INTO finance (description, category, type, amount, entry_date) VALUES ($1,$2,$3,$4,$5)`,
      [description, category, type, amount, entry_date]
    );
  }
  console.log(`✅ Seeded ${entries.length} demo finance entries`);
}

module.exports = seedDemoFinanceIfEmpty;
