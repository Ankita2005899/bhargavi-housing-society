const userModel = require('../models/user.model');
const memberModel = require('../models/member.model');
const ROLES = require('../constants/roles');
const env = require('../config/env');
const { hashPassword, verifyPassword } = require('../utils/password');
const { isValidEmail, isValidPassword } = require('../utils/validators');

const WINGS = ['Wing A', 'Wing B', 'Wing C'];

// POST /api/auth/signup — residents only. Creates a login account and
// links it either to the member record the Secretary already created
// for them, or (if none exists yet) a new minimal one. The Secretary
// account is never created through this endpoint.
async function signup(req, res) {
  try {
    const { name, wing, flat, email, password, confirmPassword } = req.body || {};

    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Full name is required.' });
    if (!WINGS.includes(wing)) return res.status(400).json({ error: 'Please select a valid wing.' });
    if (!flat || !String(flat).trim()) return res.status(400).json({ error: 'Flat / room number is required.' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });

    const existing = await userModel.findByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with this email already exists. Please log in instead.' });

    // Link to an existing (unclaimed) member record if the Secretary
    // already added one matching this name + wing + flat, otherwise
    // create a lightweight one the Secretary can complete later.
    let member = await memberModel.findUnclaimedByNameWingFlat(name, wing, flat);
    if (!member) {
      member = await memberModel.createMinimal({ name, wing, flat, email });
    }

    const passwordHash = await hashPassword(password);
    const user = await userModel.create({ email, passwordHash, role: ROLES.RESIDENT, memberId: member.id });

    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.memberId = user.member_id;

    res.status(201).json({
      success: true,
      user: { email: user.email, role: user.role, memberId: user.member_id }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create the account. Please try again.' });
  }
}

// POST /api/auth/login — used by both residents and the Secretary; the
// account's role (stored server-side) decides what it can do afterwards.
// "Remember me" simply extends the session cookie's lifetime.
async function login(req, res) {
  try {
    const { email, password, rememberMe } = req.body || {};
    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ error: 'Please enter your email and password.' });
    }
    const user = await userModel.findByEmail(email);
    const ok = user && await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.memberId = user.member_id;
    if (rememberMe) req.session.cookie.maxAge = env.sessionRememberMaxAgeMs;

    // Log this entry (time) and bump the running count — visible to the
    // Secretary under the "Accounts" / login history section.
    const stats = await userModel.recordLogin(user.id);

    res.json({
      success: true,
      user: {
        email: user.email,
        role: user.role,
        memberId: user.member_id,
        loginCount: stats.login_count,
        lastLoginAt: stats.last_login_at
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not log in. Please try again.' });
  }
}

function logout(req, res) {
  req.session.destroy(() => res.json({ success: true }));
}

// GET /api/auth/session — the front end calls this on every page load to
// know whether to show "Login" or the account menu, and to decide what a
// resident is allowed to open in the details popup.
function session(req, res) {
  if (req.session && req.session.userId) {
    return res.json({
      loggedIn: true,
      role: req.session.role,
      memberId: req.session.memberId || null
    });
  }
  res.json({ loggedIn: false });
}

// GET /api/auth/accounts — Secretary only. Every registered account
// (resident or secretary) with its linked member details and login
// stats, shown as the "Accounts" list in the Secretary section.
async function listAccounts(req, res) {
  try {
    const accounts = await userModel.findAllWithStats();
    res.json(accounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load accounts.' });
  }
}

// GET /api/auth/login-history — Secretary only. Every login entry with
// its exact time, newest first.
async function listLoginHistory(req, res) {
  try {
    const history = await userModel.findLoginHistory(200);
    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load login history.' });
  }
}

// DELETE /api/auth/accounts/:id — Secretary only. Removes a login account
// (its login history goes with it via the DB cascade). A secretary can't
// delete their own account this way, to avoid locking themselves out.
async function deleteAccount(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid account id.' });
    if (req.session.userId === id) {
      return res.status(400).json({ error: "You can't delete the account you're logged in with." });
    }
    const deleted = await userModel.deleteById(id);
    if (!deleted) return res.status(404).json({ error: 'Account not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete the account.' });
  }
}

module.exports = { signup, login, logout, session, listAccounts, listLoginHistory, deleteAccount };
