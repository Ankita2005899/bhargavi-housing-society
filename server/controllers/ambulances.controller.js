const ambulanceModel = require('../models/ambulance.model');
const { dbError } = require('../middleware/errorHandler');

async function list(req, res) {
  try { res.json(await ambulanceModel.findAll()); } catch (err) { dbError(res, err); }
}
async function publicList(req, res) {
  try { res.json(await ambulanceModel.findAllPublic()); } catch (err) { dbError(res, err); }
}
async function create(req, res) {
  try {
    const { service_name, phone } = req.body || {};
    if (!service_name || !phone) return res.status(400).json({ error: 'service_name and phone are required' });
    res.status(201).json(await ambulanceModel.create(req.body));
  } catch (err) { dbError(res, err); }
}
async function update(req, res) {
  try {
    const updated = await ambulanceModel.update(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Ambulance service not found' });
    res.json(updated);
  } catch (err) { dbError(res, err); }
}
async function remove(req, res) {
  try {
    const deleted = await ambulanceModel.remove(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Ambulance service not found' });
    res.json({ success: true, id: deleted.id });
  } catch (err) { dbError(res, err); }
}
module.exports = { list, publicList, create, update, remove };
