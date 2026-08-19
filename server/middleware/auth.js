// All access-control decisions for the app live in this one file, so the
// rule "who can see what" is never re-implemented (and never drifts)
// route by route.
//
// A logged-in session carries three things (see auth.controller.js):
//   req.session.userId    — the users.id of the logged-in account
//   req.session.role      — 'secretary' | 'resident'
//   req.session.memberId  — the members.id this account is linked to
//                            (null for the secretary account)

const ROLES = require('../constants/roles');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Please log in to continue.' });
}

function requireSecretary(req, res, next) {
  if (req.session && req.session.role === ROLES.SECRETARY) return next();
  res.status(403).json({ error: 'This area is restricted to the Secretary account.' });
}

// Allows the request through if the logged-in account is the Secretary,
// OR if it's a resident whose own member record matches :id in the URL.
// Any other case (not logged in, or a resident asking for someone else's
// record) is refused — this is what stops one resident from opening
// another resident's details from the popup.
function requireSelfOrSecretary(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Please log in to view this profile.' });
  }
  if (req.session.role === ROLES.SECRETARY) return next();

  const requestedId = String(req.params.id);
  const ownMemberId = String(req.session.memberId || '');
  if (ownMemberId && ownMemberId === requestedId) return next();

  return res.status(403).json({ error: 'You can only view your own member profile.' });
}

module.exports = { requireAuth, requireSecretary, requireSelfOrSecretary };
