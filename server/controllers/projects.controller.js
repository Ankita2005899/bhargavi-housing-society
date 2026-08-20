const projectModel = require('../models/project.model');
const { dbError } = require('../middleware/errorHandler');

async function list(req, res) {
  try { res.json(await projectModel.findAll()); } catch (err) { dbError(res, err); }
}
async function create(req, res) {
  try {
    const { title } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    res.status(201).json(await projectModel.create(req.body));
  } catch (err) { dbError(res, err); }
}
async function update(req, res) {
  try {
    const updated = await projectModel.update(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Project not found' });
    res.json(updated);
  } catch (err) { dbError(res, err); }
}
async function remove(req, res) {
  try {
    const deleted = await projectModel.remove(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Project not found' });
    res.json({ success: true, id: deleted.id });
  } catch (err) { dbError(res, err); }
}
module.exports = { list, create, update, remove };
