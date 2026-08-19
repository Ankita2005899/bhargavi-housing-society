const hospitalModel = require('../models/hospital.model');
const { dbError } = require('../middleware/errorHandler');

async function list(req, res) {
  try { res.json(await hospitalModel.findAll()); } catch (err) { dbError(res, err); }
}
async function publicList(req, res) {
  try { res.json(await hospitalModel.findAllPublic()); } catch (err) { dbError(res, err); }
}
async function create(req, res) {
  try {
    const { name, address } = req.body || {};
    if (!name || !address) return res.status(400).json({ error: 'name and address are required' });
    res.status(201).json(await hospitalModel.create(req.body));
  } catch (err) { dbError(res, err); }
}
async function update(req, res) {
  try {
    const updated = await hospitalModel.update(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Hospital not found' });
    res.json(updated);
  } catch (err) { dbError(res, err); }
}
async function remove(req, res) {
  try {
    const deleted = await hospitalModel.remove(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Hospital not found' });
    res.json({ success: true, id: deleted.id });
  } catch (err) { dbError(res, err); }
}
module.exports = { list, publicList, create, update, remove };
