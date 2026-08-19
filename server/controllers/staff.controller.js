const staffModel = require('../models/staff.model');
const { dbError } = require('../middleware/errorHandler');

async function list(req, res) {
  try { res.json(await staffModel.findAll()); } catch (err) { dbError(res, err); }
}
async function create(req, res) {
  try {
    const { name, phone } = req.body || {};
    if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });
    res.status(201).json(await staffModel.create(req.body));
  } catch (err) { dbError(res, err); }
}
async function update(req, res) {
  try {
    const { name, phone } = req.body || {};
    if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });
    const updated = await staffModel.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Staff/vendor not found' });
    res.json(updated);
  } catch (err) { dbError(res, err); }
}
async function remove(req, res) {
  try {
    const deleted = await staffModel.remove(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Staff/vendor not found' });
    res.json({ success: true, id: deleted.id });
  } catch (err) { dbError(res, err); }
}
module.exports = { list, create, update, remove };
