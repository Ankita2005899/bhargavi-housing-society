// =====================================================================
// Bhargavi Housing Society — server.js
// Whole backend (config, db, models, controllers, middleware, routes)
// consolidated into a single file. Behaviour is unchanged from the
// original multi-file version — only the file layout changed.
// =====================================================================

const express = require('express');
const path = require('path');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// ---------------------------------------------------------------------
// Config: env
// ---------------------------------------------------------------------
const required = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
};

const env = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  databaseUrl: process.env.DATABASE_URL || '',

  sessionSecret: required('SESSION_SECRET', 'bhs-dev-secret-change-me'),
  sessionMaxAgeMs: 1000 * 60 * 60 * 4,               // 4 hours (default session)
  sessionRememberMaxAgeMs: 1000 * 60 * 60 * 24 * 30, // 30 days ("remember me")

  // Bootstrap secretary account — created automatically on first boot if
  // no secretary user exists yet. Change these via Render environment
  // variables; the password is hashed before it ever touches the database.
  secretaryEmail: required('SECRETARY_EMAIL', 'secretary2@gmail.com'),
  secretaryPassword: required('SECRETARY_PASSWORD', '123456')
};

// ---------------------------------------------------------------------
// Config: database — single shared Postgres (Neon) connection pool
// ---------------------------------------------------------------------
const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseUrl && env.databaseUrl.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------
const ROLES = { SECRETARY: 'secretary', RESIDENT: 'resident' };
const WINGS = ['Wing A', 'Wing B', 'Wing C'];

// ---------------------------------------------------------------------
// Utils: password
// ---------------------------------------------------------------------
const SALT_ROUNDS = 10;
async function hashPassword(plainText) {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}
async function verifyPassword(plainText, hash) {
  if (!hash) return false;
  return bcrypt.compare(plainText, hash);
}

// ---------------------------------------------------------------------
// Utils: validators
// ---------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}
function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 6;
}
const REQUIRED_MEMBER_FIELDS = ['name', 'wing', 'flat', 'email', 'phone', 'phone_2', 'address_1', 'address_2', 'aadhaar_number', 'occupation'];
function validateMemberBody(body) {
  const missing = REQUIRED_MEMBER_FIELDS.filter(f => !String(body[f] || '').trim());
  if (missing.length) return `Missing required field(s): ${missing.join(', ')}`;
  const aadhaar = String(body.aadhaar_number).replace(/\s+/g, '');
  if (!/^\d{12}$/.test(aadhaar)) return 'Aadhaar number must be exactly 12 digits';
  return null;
}

// ---------------------------------------------------------------------
// Middleware: auth
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Middleware: error handling
// ---------------------------------------------------------------------
function dbError(res, err) {
  console.error(err);
  res.status(500).json({ error: 'Database error', detail: err.message });
}
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error' });
}

// =====================================================================
// Models — one plain object per table, each method a thin pg query
// =====================================================================

const memberModel = {
  async findAll() {
    const { rows } = await pool.query('SELECT * FROM members ORDER BY created_at ASC');
    return rows;
  },
  async count() {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM members');
    return rows[0].count;
  },
  async findById(id) {
    const { rows } = await pool.query('SELECT * FROM members WHERE id = $1', [id]);
    return rows[0] || null;
  },
  // Safe, non-sensitive fields only — used for the public directory popup.
  async findAllPublicSafe() {
    const { rows } = await pool.query(
      'SELECT id, name, wing, flat, profile_image, status FROM members ORDER BY wing ASC, flat ASC, name ASC'
    );
    return rows;
  },
  async groupedByWingAndRoom() {
    const { rows } = await pool.query('SELECT * FROM members ORDER BY wing ASC, flat ASC, created_at ASC');
    const wings = {};
    rows.forEach(m => {
      wings[m.wing] = wings[m.wing] || {};
      wings[m.wing][m.flat] = wings[m.wing][m.flat] || [];
      wings[m.wing][m.flat].push(m);
    });
    return wings;
  },
  // Used during sign-up to link a resident's new account to a member
  // record the Secretary already created (matched by name + wing + flat).
  async findUnclaimedByNameWingFlat(name, wing, flat) {
    const { rows } = await pool.query(
      `SELECT m.* FROM members m
       LEFT JOIN users u ON u.member_id = m.id
       WHERE u.id IS NULL
         AND LOWER(m.name) = LOWER($1) AND m.wing = $2 AND LOWER(m.flat) = LOWER($3)
       LIMIT 1`,
      [name, wing, flat]
    );
    return rows[0] || null;
  },
  async create(b) {
    const { rows } = await pool.query(
      `INSERT INTO members
        (name, wing, flat, phone, phone_2, email, address_1, address_2, aadhaar_number, occupation, business, profile_image, status, dues)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        b.name.trim(), b.wing, b.flat.trim(), b.phone.trim(), b.phone_2.trim(), b.email.trim(),
        b.address_1.trim(), b.address_2.trim(), String(b.aadhaar_number).replace(/\s+/g, ''),
        b.occupation.trim(), (b.business || '').trim(), (b.profile_image || '').trim(),
        b.status || 'Active', b.dues || 'Dues paid'
      ]
    );
    return rows[0];
  },
  // Minimal record created automatically when a resident signs up and no
  // matching Secretary-created row exists yet.
  async createMinimal({ name, wing, flat, email }) {
    const { rows } = await pool.query(
      `INSERT INTO members (name, wing, flat, email, status, dues)
       VALUES ($1,$2,$3,$4,'Active','Dues pending') RETURNING *`,
      [name.trim(), wing, String(flat).trim(), email.trim()]
    );
    return rows[0];
  },
  async update(id, b) {
    const { rows } = await pool.query(
      `UPDATE members SET
        name=$1, wing=$2, flat=$3, phone=$4, phone_2=$5, email=$6, address_1=$7, address_2=$8,
        aadhaar_number=$9, occupation=$10, business=$11, profile_image=$12, status=$13, dues=$14
       WHERE id=$15 RETURNING *`,
      [
        b.name.trim(), b.wing, b.flat.trim(), b.phone.trim(), b.phone_2.trim(), b.email.trim(),
        b.address_1.trim(), b.address_2.trim(), String(b.aadhaar_number).replace(/\s+/g, ''),
        b.occupation.trim(), (b.business || '').trim(), (b.profile_image || '').trim(),
        b.status || 'Active', b.dues || 'Dues paid', id
      ]
    );
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM members WHERE id=$1 RETURNING id', [id]);
    return rows[0] || null;
  }
};

const userModel = {
  async findByEmail(email) {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [String(email).toLowerCase().trim()]);
    return rows[0] || null;
  },
  async findById(id) {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] || null;
  },
  async create({ email, passwordHash, role, memberId }) {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, role, member_id) VALUES ($1,$2,$3,$4) RETURNING *`,
      [String(email).toLowerCase().trim(), passwordHash, role, memberId || null]
    );
    return rows[0];
  },
  // Called on every successful login: bumps the running count, stamps
  // the time, and adds a row to login_history.
  async recordLogin(id) {
    const { rows } = await pool.query(
      `UPDATE users SET login_count = login_count + 1, last_login_at = now()
       WHERE id = $1 RETURNING login_count, last_login_at`,
      [id]
    );
    await pool.query('INSERT INTO login_history (user_id) VALUES ($1)', [id]);
    return rows[0];
  },
  // Secretary-only: every registered account with its linked member
  // details and login stats — the "Accounts" list in the Secretary section.
  async findAllWithStats() {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, u.login_count, u.last_login_at, u.created_at,
              m.name AS member_name, m.wing, m.flat
       FROM users u
       LEFT JOIN members m ON m.id = u.member_id
       ORDER BY u.created_at ASC`
    );
    return rows;
  },
  // Secretary-only: the raw login log (time of every entry), newest first.
  async findLoginHistory(limit) {
    const { rows } = await pool.query(
      `SELECT lh.id, lh.logged_in_at, u.email, u.role, m.name AS member_name, m.wing, m.flat
       FROM login_history lh
       JOIN users u ON u.id = lh.user_id
       LEFT JOIN members m ON m.id = u.member_id
       ORDER BY lh.logged_in_at DESC
       LIMIT $1`,
      [limit || 200]
    );
    return rows;
  },
  // Secretary-only: permanently remove an account (login history cascades).
  async deleteById(id) {
    const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    return rows[0] || null;
  }
};

const financeModel = {
  async findAll() {
    const { rows } = await pool.query('SELECT * FROM finance ORDER BY entry_date DESC NULLS LAST, created_at DESC');
    return rows;
  },
  async create({ description, category, type, amount, entry_date }) {
    const { rows } = await pool.query(
      `INSERT INTO finance (description, category, type, amount, entry_date) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [description, category || 'Other', type || 'Expense', amount, entry_date || null]
    );
    return rows[0];
  },
  async update(id, { description, category, type, amount, entry_date }) {
    const { rows } = await pool.query(
      `UPDATE finance SET description=$1, category=$2, type=$3, amount=$4, entry_date=$5 WHERE id=$6 RETURNING *`,
      [description, category || 'Other', type || 'Expense', amount, entry_date || null, id]
    );
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM finance WHERE id=$1 RETURNING id', [id]);
    return rows[0] || null;
  }
};

const projectModel = {
  async findAll() {
    const { rows } = await pool.query('SELECT * FROM projects ORDER BY created_at ASC');
    return rows;
  },
  async create({ title, owner, status, budget, spent }) {
    const { rows } = await pool.query(
      `INSERT INTO projects (title, owner, status, budget, spent) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [title, owner || '', status || 'Planned', budget || 0, spent || 0]
    );
    return rows[0];
  },
  async update(id, { title, owner, status, budget, spent }) {
    const { rows } = await pool.query(
      `UPDATE projects SET title=$1, owner=$2, status=$3, budget=$4, spent=$5 WHERE id=$6 RETURNING *`,
      [title, owner || '', status || 'Planned', budget || 0, spent || 0, id]
    );
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM projects WHERE id=$1 RETURNING id', [id]);
    return rows[0] || null;
  }
};

const hospitalModel = {
  async findAll() {
    const { rows } = await pool.query('SELECT * FROM hospitals ORDER BY created_at ASC');
    return rows;
  },
  async findAllPublic() {
    const { rows } = await pool.query('SELECT id, name, address, phone_main, phone_staff, notes FROM hospitals ORDER BY created_at ASC');
    return rows;
  },
  async create({ name, address, phone_main, phone_staff, notes }) {
    const { rows } = await pool.query(
      `INSERT INTO hospitals (name, address, phone_main, phone_staff, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, address, phone_main || '', phone_staff || '', notes || '']
    );
    return rows[0];
  },
  async update(id, { name, address, phone_main, phone_staff, notes }) {
    const { rows } = await pool.query(
      `UPDATE hospitals SET name=$1, address=$2, phone_main=$3, phone_staff=$4, notes=$5 WHERE id=$6 RETURNING *`,
      [name, address, phone_main || '', phone_staff || '', notes || '', id]
    );
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM hospitals WHERE id=$1 RETURNING id', [id]);
    return rows[0] || null;
  }
};

const ambulanceModel = {
  async findAll() {
    const { rows } = await pool.query('SELECT * FROM ambulances ORDER BY eta_minutes ASC, created_at ASC');
    return rows;
  },
  async findAllPublic() {
    const { rows } = await pool.query('SELECT id, service_name, phone, eta_minutes, notes FROM ambulances ORDER BY eta_minutes ASC, created_at ASC');
    return rows;
  },
  async create({ service_name, phone, eta_minutes, notes }) {
    const { rows } = await pool.query(
      `INSERT INTO ambulances (service_name, phone, eta_minutes, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
      [service_name, phone, Number(eta_minutes) || 0, notes || '']
    );
    return rows[0];
  },
  async update(id, { service_name, phone, eta_minutes, notes }) {
    const { rows } = await pool.query(
      `UPDATE ambulances SET service_name=$1, phone=$2, eta_minutes=$3, notes=$4 WHERE id=$5 RETURNING *`,
      [service_name, phone, Number(eta_minutes) || 0, notes || '', id]
    );
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM ambulances WHERE id=$1 RETURNING id', [id]);
    return rows[0] || null;
  }
};

const staffModel = {
  async findAll() {
    const { rows } = await pool.query('SELECT * FROM staff ORDER BY created_at ASC');
    return rows;
  },
  async create({ name, role, phone, address, id_proof, profile_image, notes, status }) {
    const { rows } = await pool.query(
      `INSERT INTO staff (name, role, phone, address, id_proof, profile_image, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, role || 'Other', phone, address || '', id_proof || '', profile_image || '', notes || '', status || 'Active']
    );
    return rows[0];
  },
  async update(id, { name, role, phone, address, id_proof, profile_image, notes, status }) {
    const { rows } = await pool.query(
      `UPDATE staff SET name=$1, role=$2, phone=$3, address=$4, id_proof=$5, profile_image=$6, notes=$7, status=$8
       WHERE id=$9 RETURNING *`,
      [name, role || 'Other', phone, address || '', id_proof || '', profile_image || '', notes || '', status || 'Active', id]
    );
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM staff WHERE id=$1 RETURNING id', [id]);
    return rows[0] || null;
  }
};

const maintenanceModel = {
  // Billed per room (not per resident): one row per wing+flat, with the
  // full resident list attached so the Secretary can pick who it's
  // "shown as" — defaulting to the first resident recorded in that room.
  async findByMonth(month) {
    const { rows: members } = await pool.query(
      `SELECT id, name, wing, flat, profile_image
       FROM members ORDER BY wing ASC, flat ASC, id ASC`
    );
    const { rows: payments } = await pool.query(
      `SELECT wing, flat, amount, status, screenshot, representative_member_id
       FROM maintenance_payments WHERE month = $1 AND wing IS NOT NULL AND flat IS NOT NULL`,
      [month]
    );
    const paymentByRoom = new Map();
    payments.forEach(p => paymentByRoom.set(p.wing + '|' + p.flat, p));

    const rooms = new Map(); // "wing|flat" -> { wing, flat, members: [] }
    members.forEach(m => {
      const key = m.wing + '|' + m.flat;
      if (!rooms.has(key)) rooms.set(key, { wing: m.wing, flat: m.flat, members: [] });
      rooms.get(key).members.push({ id: m.id, name: m.name, profile_image: m.profile_image });
    });

    return [...rooms.values()].map(r => {
      const payment = paymentByRoom.get(r.wing + '|' + r.flat);
      const repId = payment && payment.representative_member_id
        ? payment.representative_member_id
        : (r.members[0] ? r.members[0].id : null);
      return {
        wing: r.wing,
        flat: r.flat,
        members: r.members,
        representative_member_id: repId,
        amount: payment ? Number(payment.amount) || 0 : 0,
        status: payment ? payment.status : 'Unpaid',
        screenshot: payment ? payment.screenshot : null
      };
    }).sort((a, b) => (a.wing + a.flat).localeCompare(b.wing + b.flat));
  },
  async upsert({ wing, flat, month, amount, status, screenshot, representative_member_id }) {
    const { rows } = await pool.query(
      `INSERT INTO maintenance_payments (wing, flat, month, amount, status, screenshot, representative_member_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (wing, flat, month)
       DO UPDATE SET amount=$4, status=$5, screenshot=$6, representative_member_id=$7, updated_at=now()
       RETURNING *`,
      [wing, flat, month, Number(amount) || 0, status === 'Paid' ? 'Paid' : 'Unpaid', screenshot || null, representative_member_id || null]
    );
    return rows[0];
  }
};

// =====================================================================
// Controllers
// =====================================================================

const authController = {
  // POST /api/auth/signup — residents only.
  async signup(req, res) {
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
  },

  // POST /api/auth/login
  async login(req, res) {
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
  },

  logout(req, res) {
    req.session.destroy(() => res.json({ success: true }));
  },

  // GET /api/auth/session
  session(req, res) {
    if (req.session && req.session.userId) {
      return res.json({
        loggedIn: true,
        role: req.session.role,
        memberId: req.session.memberId || null
      });
    }
    res.json({ loggedIn: false });
  },

  // GET /api/auth/accounts — Secretary only.
  async listAccounts(req, res) {
    try {
      const accounts = await userModel.findAllWithStats();
      res.json(accounts);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not load accounts.' });
    }
  },

  // GET /api/auth/login-history — Secretary only.
  async listLoginHistory(req, res) {
    try {
      const history = await userModel.findLoginHistory(200);
      res.json(history);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not load login history.' });
    }
  },

  // DELETE /api/auth/accounts/:id — Secretary only.
  async deleteAccount(req, res) {
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
};

const membersController = {
  async list(req, res) {
    try { res.json(await memberModel.findAll()); }
    catch (err) { dbError(res, err); }
  },
  async publicCount(req, res) {
    try { res.json({ count: await memberModel.count() }); }
    catch (err) { dbError(res, err); }
  },
  async publicSafeList(req, res) {
    try { res.json(await memberModel.findAllPublicSafe()); }
    catch (err) { dbError(res, err); }
  },
  async roomsGrouped(req, res) {
    try { res.json(await memberModel.groupedByWingAndRoom()); }
    catch (err) { dbError(res, err); }
  },
  async profile(req, res) {
    try {
      const member = await memberModel.findById(req.params.id);
      if (!member) return res.status(404).json({ error: 'Member not found' });
      res.json(member);
    } catch (err) { dbError(res, err); }
  },
  async create(req, res) {
    try {
      const b = req.body || {};
      const errMsg = validateMemberBody(b);
      if (errMsg) return res.status(400).json({ error: errMsg });
      res.status(201).json(await memberModel.create(b));
    } catch (err) { dbError(res, err); }
  },
  async update(req, res) {
    try {
      const b = req.body || {};
      const errMsg = validateMemberBody(b);
      if (errMsg) return res.status(400).json({ error: errMsg });
      const updated = await memberModel.update(req.params.id, b);
      if (!updated) return res.status(404).json({ error: 'Member not found' });
      res.json(updated);
    } catch (err) { dbError(res, err); }
  },
  async remove(req, res) {
    try {
      const deleted = await memberModel.remove(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Member not found' });
      res.json({ success: true, id: deleted.id });
    } catch (err) { dbError(res, err); }
  }
};

const financeController = {
  async list(req, res) { try { res.json(await financeModel.findAll()); } catch (err) { dbError(res, err); } },
  async create(req, res) {
    try {
      const { description, category, type, amount, entry_date } = req.body || {};
      if (!description || amount == null) return res.status(400).json({ error: 'description and amount are required' });
      res.status(201).json(await financeModel.create({ description, category, type, amount, entry_date }));
    } catch (err) { dbError(res, err); }
  },
  async update(req, res) {
    try {
      const updated = await financeModel.update(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Entry not found' });
      res.json(updated);
    } catch (err) { dbError(res, err); }
  },
  async remove(req, res) {
    try {
      const deleted = await financeModel.remove(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Entry not found' });
      res.json({ success: true, id: deleted.id });
    } catch (err) { dbError(res, err); }
  }
};

const projectsController = {
  async list(req, res) { try { res.json(await projectModel.findAll()); } catch (err) { dbError(res, err); } },
  async create(req, res) {
    try {
      const { title } = req.body || {};
      if (!title) return res.status(400).json({ error: 'title is required' });
      res.status(201).json(await projectModel.create(req.body));
    } catch (err) { dbError(res, err); }
  },
  async update(req, res) {
    try {
      const updated = await projectModel.update(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Project not found' });
      res.json(updated);
    } catch (err) { dbError(res, err); }
  },
  async remove(req, res) {
    try {
      const deleted = await projectModel.remove(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Project not found' });
      res.json({ success: true, id: deleted.id });
    } catch (err) { dbError(res, err); }
  }
};

const hospitalsController = {
  async list(req, res) { try { res.json(await hospitalModel.findAll()); } catch (err) { dbError(res, err); } },
  async publicList(req, res) { try { res.json(await hospitalModel.findAllPublic()); } catch (err) { dbError(res, err); } },
  async create(req, res) {
    try {
      const { name, address } = req.body || {};
      if (!name || !address) return res.status(400).json({ error: 'name and address are required' });
      res.status(201).json(await hospitalModel.create(req.body));
    } catch (err) { dbError(res, err); }
  },
  async update(req, res) {
    try {
      const updated = await hospitalModel.update(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Hospital not found' });
      res.json(updated);
    } catch (err) { dbError(res, err); }
  },
  async remove(req, res) {
    try {
      const deleted = await hospitalModel.remove(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Hospital not found' });
      res.json({ success: true, id: deleted.id });
    } catch (err) { dbError(res, err); }
  }
};

const ambulancesController = {
  async list(req, res) { try { res.json(await ambulanceModel.findAll()); } catch (err) { dbError(res, err); } },
  async publicList(req, res) { try { res.json(await ambulanceModel.findAllPublic()); } catch (err) { dbError(res, err); } },
  async create(req, res) {
    try {
      const { service_name, phone } = req.body || {};
      if (!service_name || !phone) return res.status(400).json({ error: 'service_name and phone are required' });
      res.status(201).json(await ambulanceModel.create(req.body));
    } catch (err) { dbError(res, err); }
  },
  async update(req, res) {
    try {
      const updated = await ambulanceModel.update(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Ambulance service not found' });
      res.json(updated);
    } catch (err) { dbError(res, err); }
  },
  async remove(req, res) {
    try {
      const deleted = await ambulanceModel.remove(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Ambulance service not found' });
      res.json({ success: true, id: deleted.id });
    } catch (err) { dbError(res, err); }
  }
};

const staffController = {
  async list(req, res) { try { res.json(await staffModel.findAll()); } catch (err) { dbError(res, err); } },
  async create(req, res) {
    try {
      const { name, phone } = req.body || {};
      if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });
      res.status(201).json(await staffModel.create(req.body));
    } catch (err) { dbError(res, err); }
  },
  async update(req, res) {
    try {
      const { name, phone } = req.body || {};
      if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });
      const updated = await staffModel.update(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: 'Staff/vendor not found' });
      res.json(updated);
    } catch (err) { dbError(res, err); }
  },
  async remove(req, res) {
    try {
      const deleted = await staffModel.remove(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Staff/vendor not found' });
      res.json({ success: true, id: deleted.id });
    } catch (err) { dbError(res, err); }
  }
};

const maintenanceController = {
  async byMonth(req, res) {
    try {
      const month = String(req.query.month || '').trim();
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month is required, format YYYY-MM' });
      res.json(await maintenanceModel.findByMonth(month));
    } catch (err) { dbError(res, err); }
  },
  async save(req, res) {
    try {
      const { wing, flat, month } = req.body || {};
      if (!wing || !flat || !/^\d{4}-\d{2}$/.test(String(month || ''))) {
        return res.status(400).json({ error: 'wing, flat and month (YYYY-MM) are required' });
      }
      res.status(201).json(await maintenanceModel.upsert(req.body));
    } catch (err) { dbError(res, err); }
  }
};

// =====================================================================
// DB: migrate (idempotent schema) + seeds (demo data, first-boot only)
// =====================================================================

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      wing TEXT NOT NULL,
      flat TEXT NOT NULL,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'Active',
      dues TEXT NOT NULL DEFAULT 'Dues paid',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE members
      ADD COLUMN IF NOT EXISTS profile_image TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS phone_2 TEXT,
      ADD COLUMN IF NOT EXISTS address_1 TEXT,
      ADD COLUMN IF NOT EXISTS address_2 TEXT,
      ADD COLUMN IF NOT EXISTS aadhaar_number TEXT,
      ADD COLUMN IF NOT EXISTS occupation TEXT,
      ADD COLUMN IF NOT EXISTS business TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'resident',
      member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS login_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      logged_in_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance (
      id SERIAL PRIMARY KEY,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other',
      type TEXT NOT NULL DEFAULT 'Expense',
      amount NUMERIC NOT NULL DEFAULT 0,
      entry_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      owner TEXT,
      status TEXT NOT NULL DEFAULT 'Planned',
      budget NUMERIC NOT NULL DEFAULT 0,
      spent NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hospitals (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      phone_main TEXT,
      phone_staff TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ambulances (
      id SERIAL PRIMARY KEY,
      service_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      eta_minutes INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Other',
      phone TEXT,
      address TEXT,
      id_proof TEXT,
      profile_image TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_payments (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      amount NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Unpaid',
      screenshot TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(member_id, month)
    );
  `);
  // Billing moved from per-member to per-room: add wing/flat + which
  // resident the room is "shown as", and a room-level unique key.
  // member_id is kept (now nullable) only for historical rows.
  await pool.query(`ALTER TABLE maintenance_payments ALTER COLUMN member_id DROP NOT NULL;`);
  await pool.query(`
    ALTER TABLE maintenance_payments
      ADD COLUMN IF NOT EXISTS wing TEXT,
      ADD COLUMN IF NOT EXISTS flat TEXT,
      ADD COLUMN IF NOT EXISTS representative_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
  `);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_payments_wing_flat_month_key'
      ) THEN
        ALTER TABLE maintenance_payments ADD CONSTRAINT maintenance_payments_wing_flat_month_key UNIQUE (wing, flat, month);
      END IF;
    END $$;
  `);

  console.log('✅ Database schema ready');
}

async function seedDemoMembersIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM members');
  if (rows[0].count > 0) return;
  const wings = ['Wing A', 'Wing B', 'Wing C'];
  const rooms = ['101', '102', '103', '104', '105'];
  const occupations = ['Service', 'Business', 'Retired', 'Homemaker', 'Self-employed'];
  let serial = 1;
  const values = [];
  const params = [];
  let p = 1;
  for (const wing of wings) {
    for (const room of rooms) {
      for (let i = 1; i <= 5; i++) {
        const aadhaar = String(100000000000 + serial).slice(-12);
        const phone = '90000' + String(10000 + serial).slice(-5);
        const phone2 = '90001' + String(10000 + serial).slice(-5);
        params.push(
          `Member ${serial} (${wing}, ${room})`, wing, room,
          phone, phone2, `member${serial}@example.com`,
          `Flat ${room}, ${wing}, Bhargavi Housing Society`, `Flat ${room}, ${wing}, Bhargavi Housing Society`,
          aadhaar, occupations[i % occupations.length], '', '',
          i === 1 ? 'Active' : 'Active', serial % 4 === 0 ? 'Dues pending' : 'Dues paid'
        );
        const placeholders = Array.from({ length: 14 }, () => `$${p++}`).join(',');
        values.push(`(${placeholders})`);
        serial++;
      }
    }
  }
  await pool.query(
    `INSERT INTO members
      (name, wing, flat, phone, phone_2, email, address_1, address_2, aadhaar_number, occupation, business, profile_image, status, dues)
     VALUES ${values.join(',')}`,
    params
  );
  console.log(`✅ Seeded ${serial - 1} demo members (3 wings × 5 rooms × 5 members)`);
}

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

async function seedDemoProjectsIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM projects');
  if (rows[0].count > 0) return;
  const entries = [
    ['Rainwater harvesting setup', 'Secretary — Mr. Kulkarni', 'Ongoing', 250000, 140000],
    ['CCTV upgrade — all wings', 'Treasurer — Mrs. Deshmukh', 'Completed', 180000, 175000],
    ['Clubhouse renovation', 'Committee member — Mr. Rao', 'Planned', 500000, 0],
    ['Garden landscaping', 'Secretary — Mr. Kulkarni', 'Ongoing', 90000, 42000],
    ['Solar panels for common lighting', 'Treasurer — Mrs. Deshmukh', 'Planned', 320000, 0]
  ];
  for (const [title, owner, status, budget, spent] of entries) {
    await pool.query(
      `INSERT INTO projects (title, owner, status, budget, spent) VALUES ($1,$2,$3,$4,$5)`,
      [title, owner, status, budget, spent]
    );
  }
  console.log(`✅ Seeded ${entries.length} demo projects`);
}

async function seedDemoHospitalsIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM hospitals');
  if (rows[0].count > 0) return;
  const entries = [
    ['Sunrise Multispeciality Hospital', 'Near Society Main Gate, MG Road', '022-49001100', '9820011223', '5 min away, 24x7 emergency'],
    ['City Care Hospital', 'Station Road, opposite bus depot', '022-49002200', '9820044556', 'Has ICU and cardiac unit'],
    ['Apex Trauma Centre', 'Highway junction, 2 km from society', '022-49003300', '9820077889', 'Best for accident/trauma cases'],
    ['Wellness Women & Child Hospital', 'Behind central market', '022-49004400', '9820099001', 'Maternity and pediatric care'],
    ['Lifeline Diagnostics & Hospital', 'Near railway station', '022-49005500', '9820033445', 'Good for lab tests and diagnostics']
  ];
  for (const [name, address, phone_main, phone_staff, notes] of entries) {
    await pool.query(
      `INSERT INTO hospitals (name, address, phone_main, phone_staff, notes) VALUES ($1,$2,$3,$4,$5)`,
      [name, address, phone_main, phone_staff, notes]
    );
  }
  console.log(`✅ Seeded ${entries.length} demo hospitals`);
}

async function seedDemoAmbulancesIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM ambulances');
  if (rows[0].count > 0) return;
  const entries = [
    ['Sunrise Hospital Ambulance', '9820011223', 8, 'ICU-equipped, comes directly from Sunrise Hospital'],
    ['City Care Ambulance Service', '9820044556', 12, 'Basic life support'],
    ['108 Government Ambulance', '108', 15, 'Free government service'],
    ['Apex Trauma Ambulance', '9820077889', 10, 'Best for accident/trauma cases'],
    ['Private Ambulance — Shree Sai Seva', '9820066778', 20, 'Available 24x7, advance booking possible']
  ];
  for (const [service_name, phone, eta_minutes, notes] of entries) {
    await pool.query(
      `INSERT INTO ambulances (service_name, phone, eta_minutes, notes) VALUES ($1,$2,$3,$4)`,
      [service_name, phone, eta_minutes, notes]
    );
  }
  console.log(`✅ Seeded ${entries.length} demo ambulance services`);
}

async function seedDemoStaffIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM staff');
  if (rows[0].count > 0) return;
  const entries = [
    ['Ramesh Yadav', 'Security Guard', '9821012345', 'Society main gate', '', 'Active', 'Day shift, 8 AM – 8 PM'],
    ['Suresh Patil', 'Plumber', '9821023456', 'Local — visits on call', '', 'Active', 'Regular plumbing contractor'],
    ['Ganesh Electricals', 'Electrician', '9821034567', 'Nearby market area', '', 'Active', 'Handles common area wiring'],
    ['Lakshmi Bai', 'Vegetable Vendor', '9821045678', 'Comes daily to society gate', '', 'Active', 'Visits every morning ~7 AM'],
    ['Anna Water Supply', 'Water Supplier (Pani Wala)', '9821056789', 'Local water tanker service', '', 'Active', 'Backup water supply on request']
  ];
  for (const [name, role, phone, address, id_proof, status, notes] of entries) {
    await pool.query(
      `INSERT INTO staff (name, role, phone, address, id_proof, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [name, role, phone, address, id_proof, status, notes]
    );
  }
  console.log(`✅ Seeded ${entries.length} demo staff/vendor entries`);
}

// Creates the one Secretary login account the first time the server ever
// boots against a fresh database. After that it's a no-op.
async function seedSecretaryAccountIfMissing() {
  const email = env.secretaryEmail.toLowerCase();
  const { rows } = await pool.query('SELECT id, role FROM users WHERE email = $1', [email]);

  if (rows.length > 0) {
    if (rows[0].role !== ROLES.SECRETARY) {
      await pool.query('UPDATE users SET role = $1 WHERE id = $2', [ROLES.SECRETARY, rows[0].id]);
      console.log(`✅ Secretary role granted to existing account (${email})`);
    }
    return;
  }

  const passwordHash = await hashPassword(env.secretaryPassword);
  await pool.query(
    `INSERT INTO users (email, password_hash, role, member_id) VALUES ($1,$2,$3,NULL)`,
    [email, passwordHash, ROLES.SECRETARY]
  );
  console.log(`✅ Secretary account ready (${email}) — sign in from the Login page.`);
}

async function runSeeds() {
  await seedDemoMembersIfEmpty();
  await seedDemoFinanceIfEmpty();
  await seedDemoProjectsIfEmpty();
  await seedDemoHospitalsIfEmpty();
  await seedDemoAmbulancesIfEmpty();
  await seedDemoStaffIfEmpty();
  await seedSecretaryAccountIfMissing();
}

// =====================================================================
// App assembly
// =====================================================================

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; needed so secure cookies work

app.use(express.json());

app.use(session({
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    maxAge: env.sessionMaxAgeMs
  }
}));

// ---------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------
const authRouter = express.Router();
authRouter.post('/signup', authController.signup);
authRouter.post('/login', authController.login);
authRouter.post('/logout', authController.logout);
authRouter.get('/session', authController.session);
authRouter.get('/accounts', requireAuth, requireSecretary, authController.listAccounts);
authRouter.get('/login-history', requireAuth, requireSecretary, authController.listLoginHistory);
authRouter.delete('/accounts/:id', requireAuth, requireSecretary, authController.deleteAccount);
app.use('/api/auth', authRouter);

const membersRouter = express.Router();
membersRouter.get('/', requireSecretary, membersController.list);
membersRouter.get('/count', membersController.publicCount);
membersRouter.get('/rooms', requireSecretary, membersController.roomsGrouped);
membersRouter.get('/:id/profile', requireSelfOrSecretary, membersController.profile);
membersRouter.post('/', requireSecretary, membersController.create);
membersRouter.put('/:id', requireSecretary, membersController.update);
membersRouter.delete('/:id', requireSecretary, membersController.remove);
app.use('/api/members', membersRouter);

// Anonymous-friendly endpoints for the homepage "View Details" popup.
// Only ever returns non-sensitive fields — see the model methods above.
const publicRouter = express.Router();
publicRouter.get('/members', membersController.publicSafeList);
publicRouter.get('/hospitals', hospitalsController.publicList);
publicRouter.get('/ambulances', ambulancesController.publicList);
app.use('/api/public', publicRouter);

const maintenanceRouter = express.Router();
maintenanceRouter.get('/', requireSecretary, maintenanceController.byMonth);
maintenanceRouter.post('/', requireSecretary, maintenanceController.save);
app.use('/api/maintenance', maintenanceRouter);

const financeRouter = express.Router();
financeRouter.get('/', requireSecretary, financeController.list);
financeRouter.post('/', requireSecretary, financeController.create);
financeRouter.put('/:id', requireSecretary, financeController.update);
financeRouter.delete('/:id', requireSecretary, financeController.remove);
app.use('/api/finance', financeRouter);

const projectsRouter = express.Router();
projectsRouter.get('/', requireSecretary, projectsController.list);
projectsRouter.post('/', requireSecretary, projectsController.create);
projectsRouter.put('/:id', requireSecretary, projectsController.update);
projectsRouter.delete('/:id', requireSecretary, projectsController.remove);
app.use('/api/projects', projectsRouter);

const hospitalsRouter = express.Router();
hospitalsRouter.get('/', requireSecretary, hospitalsController.list);
hospitalsRouter.post('/', requireSecretary, hospitalsController.create);
hospitalsRouter.put('/:id', requireSecretary, hospitalsController.update);
hospitalsRouter.delete('/:id', requireSecretary, hospitalsController.remove);
app.use('/api/hospitals', hospitalsRouter);

const ambulancesRouter = express.Router();
ambulancesRouter.get('/', requireSecretary, ambulancesController.list);
ambulancesRouter.post('/', requireSecretary, ambulancesController.create);
ambulancesRouter.put('/:id', requireSecretary, ambulancesController.update);
ambulancesRouter.delete('/:id', requireSecretary, ambulancesController.remove);
app.use('/api/ambulances', ambulancesRouter);

const staffRouter = express.Router();
staffRouter.get('/', requireSecretary, staffController.list);
staffRouter.post('/', requireSecretary, staffController.create);
staffRouter.put('/:id', requireSecretary, staffController.update);
staffRouter.delete('/:id', requireSecretary, staffController.remove);
app.use('/api/staff', staffRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', society: 'Bhargavi Housing Society' });
});

// ---------------------------------------------------------------------
// Static site — HTML pages + assets
// ---------------------------------------------------------------------
const ROOT = __dirname;
app.use(express.static(ROOT)); // serves index.html, login.html, signup.html, secretary.html, images/

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.use(errorHandler);

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
async function start() {
  if (!env.databaseUrl) {
    console.warn('⚠️  DATABASE_URL is not set — the API routes will fail until it is configured.');
  } else {
    await migrate();
    await runSeeds();
  }
  app.listen(env.port, () => {
    console.log(`Bhargavi Housing Society server running on port ${env.port}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});