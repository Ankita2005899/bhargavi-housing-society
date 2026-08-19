const financeModel = require('../models/finance.model');
const { dbError } = require('../middleware/errorHandler');

async function list(req, res) {
  try { res.json(await financeModel.findAll()); } catch (err) { dbError(res, err); }
}
async function create(req, res) {
  try {
    const { description, category, type, amount, entry_date } = req.body || {};
    if (!description || amount == null) return res.status(400).json({ error: 'description and amount are required' });
    res.status(201).json(await financeModel.create({ description, category, type, amount, entry_date }));
  } catch (err) { dbError(res, err); }
}
async function update(req, res) {
  try {
    const updated = await financeModel.update(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Entry not found' });
    res.json(updated);
  } catch (err) { dbError(res, err); }
}
async function remove(req, res) {
  try {
    const deleted = await financeModel.remove(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Entry not found' });
    res.json({ success: true, id: deleted.id });
  } catch (err) { dbError(res, err); }
}
module.exports = { list, create, update, remove };
