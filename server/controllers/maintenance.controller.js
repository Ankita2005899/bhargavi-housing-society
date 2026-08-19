const maintenanceModel = require('../models/maintenance.model');
const { dbError } = require('../middleware/errorHandler');

async function byMonth(req, res) {
  try {
    const month = String(req.query.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month is required, format YYYY-MM' });
    res.json(await maintenanceModel.findByMonth(month));
  } catch (err) { dbError(res, err); }
}
async function save(req, res) {
  try {
    const { member_id, month } = req.body || {};
    if (!member_id || !/^\d{4}-\d{2}$/.test(String(month || ''))) {
      return res.status(400).json({ error: 'member_id and month (YYYY-MM) are required' });
    }
    res.status(201).json(await maintenanceModel.upsert(req.body));
  } catch (err) { dbError(res, err); }
}
module.exports = { byMonth, save };
