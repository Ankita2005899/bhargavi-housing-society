const memberModel = require('../models/member.model');
const { dbError } = require('../middleware/errorHandler');
const { validateMemberBody } = require('../utils/validators');

// Secretary-only — full list with every field (finance-adjacent, so it
// stays behind requireSecretary at the route level).
async function list(req, res) {
  try { res.json(await memberModel.findAll()); }
  catch (err) { dbError(res, err); }
}

// Public — just the number, used for the homepage stat counter.
async function publicCount(req, res) {
  try { res.json({ count: await memberModel.count() }); }
  catch (err) { dbError(res, err); }
}

// Public — safe fields only (name, wing, flat, photo, status). Powers
// the directory list in the "View Details" popup for any visitor.
async function publicSafeList(req, res) {
  try { res.json(await memberModel.findAllPublicSafe()); }
  catch (err) { dbError(res, err); }
}

// Secretary-only — members grouped by wing -> room for the dashboard.
async function roomsGrouped(req, res) {
  try { res.json(await memberModel.groupedByWingAndRoom()); }
  catch (err) { dbError(res, err); }
}

// GET /api/members/:id/profile — gated by requireSelfOrSecretary, so by
// the time this runs the caller is either the Secretary or the resident
// who owns this exact record. Returns the full profile either way.
async function profile(req, res) {
  try {
    const member = await memberModel.findById(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    res.json(member);
  } catch (err) { dbError(res, err); }
}

async function create(req, res) {
  try {
    const b = req.body || {};
    const err = validateMemberBody(b);
    if (err) return res.status(400).json({ error: err });
    res.status(201).json(await memberModel.create(b));
  } catch (err) { dbError(res, err); }
}

async function update(req, res) {
  try {
    const b = req.body || {};
    const err = validateMemberBody(b);
    if (err) return res.status(400).json({ error: err });
    const updated = await memberModel.update(req.params.id, b);
    if (!updated) return res.status(404).json({ error: 'Member not found' });
    res.json(updated);
  } catch (err) { dbError(res, err); }
}

async function remove(req, res) {
  try {
    const deleted = await memberModel.remove(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Member not found' });
    res.json({ success: true, id: deleted.id });
  } catch (err) { dbError(res, err); }
}

module.exports = { list, publicCount, publicSafeList, roomsGrouped, profile, create, update, remove };
