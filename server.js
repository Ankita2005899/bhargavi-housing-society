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
  },
  // A resident's own room's recent dues — used by the resident dashboard,
  // scoped to their wing/flat (no cross-room visibility).
  async findForRoom(wing, flat, months = 6) {
    const { rows } = await pool.query(
      `SELECT month, amount, status, screenshot, updated_at
       FROM maintenance_payments
       WHERE wing = $1 AND flat = $2
       ORDER BY month DESC
       LIMIT $3`,
      [wing, flat, months]
    );
    return rows;
  }
};

const noticeModel = {
  // Secretary view: every notice with live like/dislike/comment counts.
  async findAllWithStats() {
    const { rows } = await pool.query(`
      SELECT n.*,
        COALESCE(l.likes, 0)::int AS likes,
        COALESCE(d.dislikes, 0)::int AS dislikes,
        COALESCE(c.comments, 0)::int AS comments
      FROM notices n
      LEFT JOIN (SELECT notice_id, COUNT(*) likes FROM notice_reactions WHERE reaction='like' GROUP BY notice_id) l ON l.notice_id = n.id
      LEFT JOIN (SELECT notice_id, COUNT(*) dislikes FROM notice_reactions WHERE reaction='dislike' GROUP BY notice_id) d ON d.notice_id = n.id
      LEFT JOIN (SELECT notice_id, COUNT(*) comments FROM notice_comments GROUP BY notice_id) c ON c.notice_id = n.id
      ORDER BY n.pinned DESC, n.created_at DESC
    `);
    return rows;
  },
  // Resident-facing view: only non-expired notices, optionally scoped to a
  // wing (a notice with target_wing NULL/'' is shown to everyone), plus
  // whether the requesting user has already reacted.
  async findActiveForUser({ wing, userId }) {
    const { rows } = await pool.query(`
      SELECT n.*,
        COALESCE(l.likes, 0)::int AS likes,
        COALESCE(d.dislikes, 0)::int AS dislikes,
        COALESCE(c.comments, 0)::int AS comments,
        r.reaction AS my_reaction
      FROM notices n
      LEFT JOIN (SELECT notice_id, COUNT(*) likes FROM notice_reactions WHERE reaction='like' GROUP BY notice_id) l ON l.notice_id = n.id
      LEFT JOIN (SELECT notice_id, COUNT(*) dislikes FROM notice_reactions WHERE reaction='dislike' GROUP BY notice_id) d ON d.notice_id = n.id
      LEFT JOIN (SELECT notice_id, COUNT(*) comments FROM notice_comments GROUP BY notice_id) c ON c.notice_id = n.id
      LEFT JOIN notice_reactions r ON r.notice_id = n.id AND r.user_id = $2
      WHERE (n.expires_at IS NULL OR n.expires_at >= CURRENT_DATE)
        AND (n.publish_date IS NULL OR n.publish_date <= CURRENT_DATE)
        AND (n.target_wing IS NULL OR n.target_wing = '' OR n.target_wing = $1)
      ORDER BY n.pinned DESC, n.created_at DESC
    `, [wing || null, userId || null]);
    return rows;
  },
  async findById(id) {
    const { rows } = await pool.query('SELECT * FROM notices WHERE id = $1', [id]);
    return rows[0] || null;
  },
  async create({ title, message, category, priority, target_wing, expires_at, pinned, created_by, publish_date }) {
    const { rows } = await pool.query(
      `INSERT INTO notices (title, message, category, priority, target_wing, expires_at, pinned, created_by, publish_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [title.trim(), message.trim(), category || 'General', priority || 'Normal',
       (target_wing || '').trim() || null, expires_at || null, !!pinned, created_by || 'Secretary',
       publish_date || null]
    );
    return rows[0];
  },
  async update(id, { title, message, category, priority, target_wing, expires_at, pinned }) {
    const { rows } = await pool.query(
      `UPDATE notices SET title=$1, message=$2, category=$3, priority=$4, target_wing=$5,
        expires_at=$6, pinned=$7, updated_at=now()
       WHERE id=$8 RETURNING *`,
      [title.trim(), message.trim(), category || 'General', priority || 'Normal',
       (target_wing || '').trim() || null, expires_at || null, !!pinned, id]
    );
    return rows[0] || null;
  },
  async setPinned(id, pinned) {
    const { rows } = await pool.query('UPDATE notices SET pinned=$1 WHERE id=$2 RETURNING *', [!!pinned, id]);
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM notices WHERE id=$1 RETURNING id', [id]);
    return rows[0] || null;
  },
  // Full engagement breakdown for the Secretary's "who reacted" view —
  // every like/dislike and every comment, each with who and when.
  async engagement(id) {
    const { rows: reactions } = await pool.query(
      `SELECT nr.reaction, nr.created_at, u.email, u.role, m.name AS member_name, m.wing, m.flat
       FROM notice_reactions nr
       JOIN users u ON u.id = nr.user_id
       LEFT JOIN members m ON m.id = u.member_id
       WHERE nr.notice_id = $1
       ORDER BY nr.created_at DESC`,
      [id]
    );
    const { rows: comments } = await pool.query(
      `SELECT nc.id, nc.comment, nc.created_at, nc.author_name, u.email, u.role, m.wing, m.flat
       FROM notice_comments nc
       LEFT JOIN users u ON u.id = nc.user_id
       LEFT JOIN members m ON m.id = u.member_id
       WHERE nc.notice_id = $1
       ORDER BY nc.created_at ASC`,
      [id]
    );
    return {
      likes: reactions.filter(r => r.reaction === 'like'),
      dislikes: reactions.filter(r => r.reaction === 'dislike'),
      comments
    };
  }
};

const noticeReactionModel = {
  // Toggle semantics: same reaction again removes it, a different
  // reaction replaces it. Always records who + when via the unique
  // (notice_id, user_id) row.
  async setReaction(noticeId, userId, reaction) {
    const { rows: existing } = await pool.query(
      'SELECT reaction FROM notice_reactions WHERE notice_id=$1 AND user_id=$2', [noticeId, userId]
    );
    if (existing[0] && existing[0].reaction === reaction) {
      await pool.query('DELETE FROM notice_reactions WHERE notice_id=$1 AND user_id=$2', [noticeId, userId]);
      return { reaction: null };
    }
    await pool.query(
      `INSERT INTO notice_reactions (notice_id, user_id, reaction) VALUES ($1,$2,$3)
       ON CONFLICT (notice_id, user_id) DO UPDATE SET reaction=$3, created_at=now()`,
      [noticeId, userId, reaction]
    );
    return { reaction };
  }
};

const noticeCommentModel = {
  async create({ notice_id, user_id, author_name, comment }) {
    const { rows } = await pool.query(
      `INSERT INTO notice_comments (notice_id, user_id, author_name, comment) VALUES ($1,$2,$3,$4) RETURNING *`,
      [notice_id, user_id || null, author_name, comment.trim()]
    );
    return rows[0];
  },
  async findById(id) {
    const { rows } = await pool.query('SELECT * FROM notice_comments WHERE id=$1', [id]);
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM notice_comments WHERE id=$1 RETURNING id', [id]);
    return rows[0] || null;
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
  },
  // GET /api/maintenance/mine — any logged-in resident: their own room's
  // real dues history, resolved from their linked member record. A
  // Secretary account with no linked member record gets a clear 404
  // rather than someone else's data.
  async mine(req, res) {
    try {
      if (!req.session.memberId) {
        return res.status(404).json({ error: 'No member record is linked to this account' });
      }
      const member = await memberModel.findById(req.session.memberId);
      if (!member) return res.status(404).json({ error: 'Member not found' });
      const history = await maintenanceModel.findForRoom(member.wing, member.flat, 6);
      res.json({ wing: member.wing, flat: member.flat, history });
    } catch (err) { dbError(res, err); }
  }
};

const eventModel = {
  async findAllWithStats() {
    const { rows } = await pool.query(`
      SELECT e.*,
        COALESCE(x.total_expense, 0)::numeric AS total_expense,
        COALESCE(p.total_paid, 0)::numeric AS total_collected,
        COALESCE(p.total_pending, 0)::numeric AS total_pending,
        COALESCE(x.expense_count, 0)::int AS expense_count,
        COALESCE(p.payment_count, 0)::int AS payment_count
      FROM events e
      LEFT JOIN (
        SELECT event_id, SUM(amount) total_expense, COUNT(*) expense_count
        FROM event_expenses GROUP BY event_id
      ) x ON x.event_id = e.id
      LEFT JOIN (
        SELECT event_id,
          SUM(amount) FILTER (WHERE status = 'Paid') total_paid,
          SUM(amount) FILTER (WHERE status = 'Pending') total_pending,
          COUNT(*) payment_count
        FROM event_payments GROUP BY event_id
      ) p ON p.event_id = e.id
      ORDER BY e.start_date DESC NULLS LAST, e.created_at DESC
    `);
    return rows;
  },
  async findById(id) {
    const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
    return rows[0] || null;
  },
  // Public/resident-facing view: no financial figures (budget, expenses,
  // collections) — just what's needed to show the event on the site.
  async findPublicAll() {
    const { rows } = await pool.query(`
      SELECT id, title, description, category, start_date, end_date, location, image, status, created_at
      FROM events
      WHERE status IS NULL OR status <> 'Cancelled'
      ORDER BY start_date DESC NULLS LAST, created_at DESC
    `);
    return rows;
  },
  async create(b) {
    const { rows } = await pool.query(
      `INSERT INTO events (title, description, category, start_date, end_date, location, image, status, budget_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [b.title.trim(), (b.description || '').trim(), b.category || 'General', b.start_date || null,
       b.end_date || null, (b.location || '').trim(), b.image || null, b.status || 'Upcoming', Number(b.budget_total) || 0]
    );
    return rows[0];
  },
  async update(id, b) {
    const { rows } = await pool.query(
      `UPDATE events SET title=$1, description=$2, category=$3, start_date=$4, end_date=$5,
        location=$6, image=$7, status=$8, budget_total=$9, updated_at=now()
       WHERE id=$10 RETURNING *`,
      [b.title.trim(), (b.description || '').trim(), b.category || 'General', b.start_date || null,
       b.end_date || null, (b.location || '').trim(), b.image || null, b.status || 'Upcoming', Number(b.budget_total) || 0, id]
    );
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM events WHERE id=$1 RETURNING id', [id]);
    return rows[0] || null;
  },
  // Full detail view: the event plus its expense breakdown, payment/dues
  // ledger, and any free-form custom fields the Secretary has added.
  async findFullById(id) {
    const event = await this.findById(id);
    if (!event) return null;
    const { rows: expenses } = await pool.query('SELECT * FROM event_expenses WHERE event_id=$1 ORDER BY created_at ASC', [id]);
    const { rows: payments } = await pool.query('SELECT * FROM event_payments WHERE event_id=$1 ORDER BY created_at ASC', [id]);
    const { rows: fields } = await pool.query('SELECT * FROM event_fields WHERE event_id=$1 ORDER BY created_at ASC', [id]);
    return { ...event, expenses, payments, fields };
  }
};

const eventExpenseModel = {
  async create({ event_id, part_name, category, amount, day_label, notes }) {
    const { rows } = await pool.query(
      `INSERT INTO event_expenses (event_id, part_name, category, amount, day_label, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [event_id, part_name.trim(), category || 'Other', Number(amount) || 0, (day_label || '').trim(), (notes || '').trim()]
    );
    return rows[0];
  },
  async update(id, { part_name, category, amount, day_label, notes }) {
    const { rows } = await pool.query(
      `UPDATE event_expenses SET part_name=$1, category=$2, amount=$3, day_label=$4, notes=$5 WHERE id=$6 RETURNING *`,
      [part_name.trim(), category || 'Other', Number(amount) || 0, (day_label || '').trim(), (notes || '').trim(), id]
    );
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM event_expenses WHERE id=$1 RETURNING id, event_id', [id]);
    return rows[0] || null;
  }
};

const eventPaymentModel = {
  async create({ event_id, payer_name, amount, status, due_date, notes }) {
    const { rows } = await pool.query(
      `INSERT INTO event_payments (event_id, payer_name, amount, status, due_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [event_id, payer_name.trim(), Number(amount) || 0, status === 'Paid' ? 'Paid' : 'Pending', due_date || null, (notes || '').trim()]
    );
    return rows[0];
  },
  async update(id, { payer_name, amount, status, due_date, notes }) {
    const { rows } = await pool.query(
      `UPDATE event_payments SET payer_name=$1, amount=$2, status=$3, due_date=$4, notes=$5 WHERE id=$6 RETURNING *`,
      [payer_name.trim(), Number(amount) || 0, status === 'Paid' ? 'Paid' : 'Pending', due_date || null, (notes || '').trim(), id]
    );
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM event_payments WHERE id=$1 RETURNING id, event_id', [id]);
    return rows[0] || null;
  }
};

const eventFieldModel = {
  async create({ event_id, field_key, field_value }) {
    const { rows } = await pool.query(
      `INSERT INTO event_fields (event_id, field_key, field_value) VALUES ($1,$2,$3) RETURNING *`,
      [event_id, field_key.trim(), (field_value || '').trim()]
    );
    return rows[0];
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM event_fields WHERE id=$1 RETURNING id, event_id', [id]);
    return rows[0] || null;
  }
};

const governanceModel = {
  async findAll() {
    const { rows } = await pool.query('SELECT * FROM governance_items ORDER BY created_at DESC');
    return rows;
  },
  async findById(id) {
    const { rows } = await pool.query('SELECT * FROM governance_items WHERE id = $1', [id]);
    return rows[0] || null;
  },
  async create(b) {
    const { rows } = await pool.query(
      `INSERT INTO governance_items (title, description, link, image)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [(b.title || '').trim() || null, (b.description || '').trim() || null,
       (b.link || '').trim() || null, b.image || null]
    );
    return rows[0];
  },
  async update(id, b) {
    const { rows } = await pool.query(
      `UPDATE governance_items SET title=$1, description=$2, link=$3, image=$4, updated_at=now()
       WHERE id=$5 RETURNING *`,
      [(b.title || '').trim() || null, (b.description || '').trim() || null,
       (b.link || '').trim() || null, b.image || null, id]
    );
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM governance_items WHERE id=$1 RETURNING id', [id]);
    return rows[0] || null;
  }
};

const eventYearModel = {
  async findBySlug(slug) {
    const { rows } = await pool.query(
      'SELECT * FROM event_year_records WHERE event_slug=$1 ORDER BY year ASC',
      [slug]
    );
    return rows;
  },
  // Create-or-update the one row for (event_slug, year) in a single query.
  async upsert(slug, year, b) {
    const { rows } = await pool.query(
      `INSERT INTO event_year_records
         (event_slug, year, organized_by, fund_provided, fund_source, fund_amount, budget_required, attendance, image, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (event_slug, year) DO UPDATE SET
         organized_by = EXCLUDED.organized_by,
         fund_provided = EXCLUDED.fund_provided,
         fund_source = EXCLUDED.fund_source,
         fund_amount = EXCLUDED.fund_amount,
         budget_required = EXCLUDED.budget_required,
         attendance = EXCLUDED.attendance,
         image = EXCLUDED.image,
         notes = EXCLUDED.notes,
         updated_at = now()
       RETURNING *`,
      [
        slug, year,
        (b.organized_by || '').trim() || null,
        !!b.fund_provided,
        (b.fund_source || '').trim() || null,
        b.fund_amount === '' || b.fund_amount === undefined ? null : b.fund_amount,
        b.budget_required === '' || b.budget_required === undefined ? null : b.budget_required,
        b.attendance === '' || b.attendance === undefined ? null : b.attendance,
        b.image || null,
        (b.notes || '').trim() || null
      ]
    );
    return rows[0];
  },
  async remove(slug, year) {
    const { rows } = await pool.query(
      'DELETE FROM event_year_records WHERE event_slug=$1 AND year=$2 RETURNING id',
      [slug, year]
    );
    return rows[0] || null;
  }
};

const eventContentModel = {
  async findBySlug(slug) {
    const { rows } = await pool.query('SELECT * FROM event_content WHERE event_slug=$1', [slug]);
    return rows[0] || null;
  },
  // Full snapshot upsert — the edit-mode toolbar always sends every field
  // it knows about (even unchanged ones), so a straight overwrite is safe.
  async upsert(slug, b) {
    const { rows } = await pool.query(
      `INSERT INTO event_content
         (event_slug, title, teaser, detail, highlights, organized_by, fund_source, venue, when_text, contact, image, start_year)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (event_slug) DO UPDATE SET
         title = EXCLUDED.title,
         teaser = EXCLUDED.teaser,
         detail = EXCLUDED.detail,
         highlights = EXCLUDED.highlights,
         organized_by = EXCLUDED.organized_by,
         fund_source = EXCLUDED.fund_source,
         venue = EXCLUDED.venue,
         when_text = EXCLUDED.when_text,
         contact = EXCLUDED.contact,
         image = EXCLUDED.image,
         start_year = EXCLUDED.start_year,
         updated_at = now()
       RETURNING *`,
      [
        slug,
        (b.title || '').trim() || null,
        (b.teaser || '').trim() || null,
        (b.detail || '').trim() || null,
        (b.highlights || '').trim() || null,
        (b.organized_by || '').trim() || null,
        (b.fund_source || '').trim() || null,
        (b.venue || '').trim() || null,
        (b.when_text || '').trim() || null,
        (b.contact || '').trim() || null,
        b.image || null,
        b.start_year === '' || b.start_year === undefined || b.start_year === null ? null : parseInt(b.start_year, 10)
      ]
    );
    return rows[0];
  }
};

const meetingModel = {
  async findAll() {
    const { rows } = await pool.query('SELECT * FROM meetings ORDER BY meeting_date DESC NULLS LAST, start_time DESC NULLS LAST, created_at DESC');
    return rows;
  },
  async findById(id) {
    const { rows } = await pool.query('SELECT * FROM meetings WHERE id = $1', [id]);
    return rows[0] || null;
  },
  // Any meeting whose date + end time hasn't passed yet — used to drive the
  // compulsory pop-up on the Secretary dashboard until the meeting ends.
  async findActive() {
    const { rows } = await pool.query(`
      SELECT * FROM meetings
      WHERE meeting_date IS NOT NULL AND end_time IS NOT NULL
        AND (meeting_date + end_time::time) >= now()
      ORDER BY meeting_date ASC, start_time ASC
    `);
    return rows;
  },
  async create(b) {
    const { rows } = await pool.query(
      `INSERT INTO meetings (title, description, meeting_date, start_time, end_time, location, meeting_link, image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [(b.title || '').trim() || null, (b.description || '').trim() || null, b.meeting_date || null,
       b.start_time || null, b.end_time || null, (b.location || '').trim() || null,
       (b.meeting_link || '').trim() || null, b.image || null]
    );
    return rows[0];
  },
  async update(id, b) {
    const { rows } = await pool.query(
      `UPDATE meetings SET title=$1, description=$2, meeting_date=$3, start_time=$4, end_time=$5,
        location=$6, meeting_link=$7, image=$8, updated_at=now()
       WHERE id=$9 RETURNING *`,
      [(b.title || '').trim() || null, (b.description || '').trim() || null, b.meeting_date || null,
       b.start_time || null, b.end_time || null, (b.location || '').trim() || null,
       (b.meeting_link || '').trim() || null, b.image || null, id]
    );
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM meetings WHERE id=$1 RETURNING id', [id]);
    return rows[0] || null;
  }
};

const governanceController = {
  async list(req, res) { try { res.json(await governanceModel.findAll()); } catch (err) { dbError(res, err); } },
  // GET /api/public/governance — anyone (no login needed): same fields,
  // governance items have nothing sensitive in them.
  async publicList(req, res) { try { res.json(await governanceModel.findAll()); } catch (err) { dbError(res, err); } },
  async create(req, res) {
    try { res.status(201).json(await governanceModel.create(req.body || {})); } catch (err) { dbError(res, err); }
  },
  async update(req, res) {
    try {
      const updated = await governanceModel.update(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Governance item not found' });
      res.json(updated);
    } catch (err) { dbError(res, err); }
  },
  async remove(req, res) {
    try {
      const deleted = await governanceModel.remove(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Governance item not found' });
      res.json({ success: true, id: deleted.id });
    } catch (err) { dbError(res, err); }
  }
};

const eventYearController = {
  // GET /api/event-years/:slug — logged-in residents & Secretary: every
  // recorded year for that festival/event, oldest first.
  async list(req, res) {
    try { res.json(await eventYearModel.findBySlug(String(req.params.slug))); }
    catch (err) { dbError(res, err); }
  },
  // PUT /api/event-years/:slug/:year — Secretary only: add or update the
  // record for that event+year (create-or-update in one call).
  async upsert(req, res) {
    try {
      const year = parseInt(req.params.year, 10);
      if (!req.params.slug || !Number.isInteger(year)) {
        return res.status(400).json({ error: 'A valid event slug and year are required.' });
      }
      res.json(await eventYearModel.upsert(String(req.params.slug), year, req.body || {}));
    } catch (err) { dbError(res, err); }
  },
  async remove(req, res) {
    try {
      const year = parseInt(req.params.year, 10);
      const deleted = await eventYearModel.remove(String(req.params.slug), year);
      if (!deleted) return res.status(404).json({ error: 'No record for that event and year' });
      res.json({ success: true, id: deleted.id });
    } catch (err) { dbError(res, err); }
  }
};

const eventContentController = {
  // GET /api/event-content/:slug — logged-in residents & Secretary: the
  // saved overrides for that event's page (or null if never edited).
  async get(req, res) {
    try { res.json(await eventContentModel.findBySlug(String(req.params.slug))); }
    catch (err) { dbError(res, err); }
  },
  // PUT /api/event-content/:slug — Secretary only: overwrite the saved
  // content for that event's page (from the "Website (edit mode)" toolbar).
  async upsert(req, res) {
    try { res.json(await eventContentModel.upsert(String(req.params.slug), req.body || {})); }
    catch (err) { dbError(res, err); }
  }
};

const meetingsController = {
  async list(req, res) { try { res.json(await meetingModel.findAll()); } catch (err) { dbError(res, err); } },
  async active(req, res) { try { res.json(await meetingModel.findActive()); } catch (err) { dbError(res, err); } },
  // GET /api/public/meetings/active — anyone (no login needed): drives the
  // resident-facing "scheduled meeting" pop-up on index.html, same data and
  // same "stays until end time" rule as the Secretary dashboard banner.
  async publicActive(req, res) { try { res.json(await meetingModel.findActive()); } catch (err) { dbError(res, err); } },
  async create(req, res) {
    try {
      const { meeting_date, end_time } = req.body || {};
      if (!meeting_date || !String(meeting_date).trim()) return res.status(400).json({ error: 'Meeting date is required.' });
      if (!end_time || !String(end_time).trim()) return res.status(400).json({ error: 'Meeting end time is required.' });
      res.status(201).json(await meetingModel.create(req.body));
    } catch (err) { dbError(res, err); }
  },
  async update(req, res) {
    try {
      const { meeting_date, end_time } = req.body || {};
      if (!meeting_date || !String(meeting_date).trim()) return res.status(400).json({ error: 'Meeting date is required.' });
      if (!end_time || !String(end_time).trim()) return res.status(400).json({ error: 'Meeting end time is required.' });
      const updated = await meetingModel.update(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: 'Meeting not found' });
      res.json(updated);
    } catch (err) { dbError(res, err); }
  },
  async remove(req, res) {
    try {
      const deleted = await meetingModel.remove(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Meeting not found' });
      res.json({ success: true, id: deleted.id });
    } catch (err) { dbError(res, err); }
  }
};

const noticeRequestModel = {
  async create(r) {
    const { rows } = await pool.query(
      `INSERT INTO notice_requests (user_id, topic, category, priority, details, reason, from_name, to_audience, contact, display_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [r.user_id || null, r.topic.trim(), r.category || 'General', r.priority || 'Normal', r.details.trim(),
       (r.reason || '').trim() || null, r.from_name.trim(), r.to_audience.trim(), (r.contact || '').trim() || null, r.display_date]
    );
    return rows[0];
  },
  async findAll() {
    const { rows } = await pool.query(
      `SELECT nr.*, u.email AS submitted_by_email
       FROM notice_requests nr LEFT JOIN users u ON u.id = nr.user_id
       ORDER BY (nr.status = 'pending') DESC, nr.submitted_at DESC`
    );
    return rows;
  },
  async findMine(userId) {
    const { rows } = await pool.query(
      'SELECT id, topic, to_audience, display_date, status, submitted_at FROM notice_requests WHERE user_id=$1 ORDER BY submitted_at DESC LIMIT 20', [userId]
    );
    return rows;
  },
  async findById(id) {
    const { rows } = await pool.query('SELECT * FROM notice_requests WHERE id=$1', [id]);
    return rows[0] || null;
  },
  async unseenCount() {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM notice_requests WHERE seen = false');
    return rows[0].count;
  },
  async markAllSeen() { await pool.query('UPDATE notice_requests SET seen = true WHERE seen = false'); },
  async decide(id, status, noticeId) {
    const { rows } = await pool.query(
      `UPDATE notice_requests SET status=$1, notice_id=$2, seen=true, decided_at=now() WHERE id=$3 RETURNING *`,
      [status, noticeId || null, id]
    );
    return rows[0] || null;
  },
  async remove(id) {
    const { rows } = await pool.query('DELETE FROM notice_requests WHERE id=$1 RETURNING id', [id]);
    return rows[0] || null;
  }
};

const noticeRequestsController = {
  // POST /api/notice-requests — any logged-in user.
  async create(req, res) {
    try {
      const b = req.body || {};
      const need = { topic: 'Topic of the notice', details: 'Notice details', from_name: 'From (your name)', to_audience: 'To (who is it for)', display_date: 'Date to show on the notice board' };
      for (const k of Object.keys(need)) {
        if (!b[k] || !String(b[k]).trim()) return res.status(400).json({ error: need[k] + ' is required.' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.display_date))) return res.status(400).json({ error: 'Please choose a valid display date.' });
      const created = await noticeRequestModel.create({ ...b, user_id: req.session.userId });
      res.status(201).json({ success: true, id: created.id });
    } catch (err) { dbError(res, err); }
  },
  async mine(req, res) { try { res.json(await noticeRequestModel.findMine(req.session.userId)); } catch (err) { dbError(res, err); } },
  async list(req, res) { try { res.json(await noticeRequestModel.findAll()); } catch (err) { dbError(res, err); } },
  async unseenCount(req, res) { try { res.json({ count: await noticeRequestModel.unseenCount() }); } catch (err) { dbError(res, err); } },
  async markSeen(req, res) { try { await noticeRequestModel.markAllSeen(); res.json({ success: true }); } catch (err) { dbError(res, err); } },
  // PATCH /api/notice-requests/:id/decision  Body: { decision: 'approve' | 'reject' }
  async decide(req, res) {
    try {
      const { decision } = req.body || {};
      if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Decision must be approve or reject.' });
      const r = await noticeRequestModel.findById(req.params.id);
      if (!r) return res.status(404).json({ error: 'Request not found' });
      if (r.status !== 'pending') return res.status(400).json({ error: 'This request was already ' + r.status + '.' });
      let noticeId = null;
      if (decision === 'approve') {
        const wingMatch = /^wing\s+\S+$/i.test(r.to_audience.trim());
        const notice = await noticeModel.create({
          title: r.topic,
          message: r.details + (r.reason ? '\n\nReason: ' + r.reason : '') + '\n\nFrom: ' + r.from_name + ' — To: ' + r.to_audience,
          category: r.category, priority: r.priority,
          target_wing: wingMatch ? r.to_audience.trim() : null,
          publish_date: r.display_date, created_by: r.from_name
        });
        noticeId = notice.id;
      }
      res.json(await noticeRequestModel.decide(r.id, decision === 'approve' ? 'approved' : 'rejected', noticeId));
    } catch (err) { dbError(res, err); }
  },
  async remove(req, res) {
    try {
      const d = await noticeRequestModel.remove(req.params.id);
      if (!d) return res.status(404).json({ error: 'Request not found' });
      res.json({ success: true });
    } catch (err) { dbError(res, err); }
  }
};

const noticesController = {
  // GET /api/notices — Secretary only: every notice + counts.
  async list(req, res) { try { res.json(await noticeModel.findAllWithStats()); } catch (err) { dbError(res, err); } },

  // GET /api/notices/active — any logged-in user (resident or secretary):
  // active notices scoped to their wing, with their own reaction attached.
  async listActive(req, res) {
    try {
      let wing = null;
      if (req.session.role === 'resident' && req.session.memberId) {
        const member = await memberModel.findById(req.session.memberId);
        wing = member ? member.wing : null;
      }
      res.json(await noticeModel.findActiveForUser({ wing, userId: req.session.userId }));
    } catch (err) { dbError(res, err); }
  },

  // GET /api/public/notices — anyone (no login needed): active, unscoped
  // notices with no wing filter and no "my reaction" (there's no user).
  async publicActive(req, res) {
    try {
      res.json(await noticeModel.findActiveForUser({ wing: null, userId: null }));
    } catch (err) { dbError(res, err); }
  },

  async create(req, res) {
    try {
      const { title, message } = req.body || {};
      if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required.' });
      if (!message || !String(message).trim()) return res.status(400).json({ error: 'Notice message is required.' });
      const created_by = req.session.userId ? (await userModel.findById(req.session.userId)).email : 'Secretary';
      res.status(201).json(await noticeModel.create({ ...req.body, created_by }));
    } catch (err) { dbError(res, err); }
  },
  async update(req, res) {
    try {
      const { title, message } = req.body || {};
      if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required.' });
      if (!message || !String(message).trim()) return res.status(400).json({ error: 'Notice message is required.' });
      const updated = await noticeModel.update(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: 'Notice not found' });
      res.json(updated);
    } catch (err) { dbError(res, err); }
  },
  async setPinned(req, res) {
    try {
      const updated = await noticeModel.setPinned(req.params.id, !!(req.body || {}).pinned);
      if (!updated) return res.status(404).json({ error: 'Notice not found' });
      res.json(updated);
    } catch (err) { dbError(res, err); }
  },
  async remove(req, res) {
    try {
      const deleted = await noticeModel.remove(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Notice not found' });
      res.json({ success: true, id: deleted.id });
    } catch (err) { dbError(res, err); }
  },
  // GET /api/notices/:id/engagement — Secretary only: who liked, who
  // disliked, and every comment, each with a timestamp.
  async engagement(req, res) {
    try {
      const notice = await noticeModel.findById(req.params.id);
      if (!notice) return res.status(404).json({ error: 'Notice not found' });
      res.json(await noticeModel.engagement(req.params.id));
    } catch (err) { dbError(res, err); }
  },

  // POST /api/notices/:id/react — any logged-in user. Body: { reaction: 'like'|'dislike' }
  async react(req, res) {
    try {
      const { reaction } = req.body || {};
      if (!['like', 'dislike'].includes(reaction)) return res.status(400).json({ error: 'reaction must be like or dislike' });
      const notice = await noticeModel.findById(req.params.id);
      if (!notice) return res.status(404).json({ error: 'Notice not found' });
      const result = await noticeReactionModel.setReaction(req.params.id, req.session.userId, reaction);
      res.json(result);
    } catch (err) { dbError(res, err); }
  },

  // POST /api/notices/:id/comments — any logged-in user.
  async addComment(req, res) {
    try {
      const { comment } = req.body || {};
      if (!comment || !String(comment).trim()) return res.status(400).json({ error: 'Comment text is required.' });
      const notice = await noticeModel.findById(req.params.id);
      if (!notice) return res.status(404).json({ error: 'Notice not found' });
      const user = await userModel.findById(req.session.userId);
      let authorName = 'Secretary';
      if (user.role === 'resident') {
        const member = user.member_id ? await memberModel.findById(user.member_id) : null;
        authorName = member ? `${member.name} (${member.wing}, ${member.flat})` : user.email;
      }
      const created = await noticeCommentModel.create({
        notice_id: req.params.id, user_id: req.session.userId, author_name: authorName, comment
      });
      res.status(201).json(created);
    } catch (err) { dbError(res, err); }
  },
  // DELETE /api/notices/comments/:id — Secretary, or the comment's own author.
  async removeComment(req, res) {
    try {
      const comment = await noticeCommentModel.findById(req.params.id);
      if (!comment) return res.status(404).json({ error: 'Comment not found' });
      const isOwner = comment.user_id && String(comment.user_id) === String(req.session.userId);
      if (req.session.role !== ROLES.SECRETARY && !isOwner) {
        return res.status(403).json({ error: 'You can only delete your own comment.' });
      }
      await noticeCommentModel.remove(req.params.id);
      res.json({ success: true, id: comment.id });
    } catch (err) { dbError(res, err); }
  }
};

const eventsController = {
  async list(req, res) { try { res.json(await eventModel.findAllWithStats()); } catch (err) { dbError(res, err); } },
  // GET /api/public/events — anyone (no login needed): safe fields only.
  async publicList(req, res) { try { res.json(await eventModel.findPublicAll()); } catch (err) { dbError(res, err); } },
  async full(req, res) {
    try {
      const event = await eventModel.findFullById(req.params.id);
      if (!event) return res.status(404).json({ error: 'Event not found' });
      res.json(event);
    } catch (err) { dbError(res, err); }
  },
  async create(req, res) {
    try {
      const { title } = req.body || {};
      if (!title || !String(title).trim()) return res.status(400).json({ error: 'Event title is required.' });
      res.status(201).json(await eventModel.create(req.body));
    } catch (err) { dbError(res, err); }
  },
  async update(req, res) {
    try {
      const { title } = req.body || {};
      if (!title || !String(title).trim()) return res.status(400).json({ error: 'Event title is required.' });
      const updated = await eventModel.update(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: 'Event not found' });
      res.json(updated);
    } catch (err) { dbError(res, err); }
  },
  async remove(req, res) {
    try {
      const deleted = await eventModel.remove(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Event not found' });
      res.json({ success: true, id: deleted.id });
    } catch (err) { dbError(res, err); }
  },

  async addExpense(req, res) {
    try {
      const { part_name, amount } = req.body || {};
      if (!part_name || !String(part_name).trim()) return res.status(400).json({ error: 'Part / item name is required.' });
      if (amount == null || isNaN(Number(amount))) return res.status(400).json({ error: 'A valid amount is required.' });
      const event = await eventModel.findById(req.params.id);
      if (!event) return res.status(404).json({ error: 'Event not found' });
      res.status(201).json(await eventExpenseModel.create({ ...req.body, event_id: req.params.id }));
    } catch (err) { dbError(res, err); }
  },
  async updateExpense(req, res) {
    try {
      const updated = await eventExpenseModel.update(req.params.expenseId, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Expense item not found' });
      res.json(updated);
    } catch (err) { dbError(res, err); }
  },
  async removeExpense(req, res) {
    try {
      const deleted = await eventExpenseModel.remove(req.params.expenseId);
      if (!deleted) return res.status(404).json({ error: 'Expense item not found' });
      res.json({ success: true, id: deleted.id });
    } catch (err) { dbError(res, err); }
  },

  async addPayment(req, res) {
    try {
      const { payer_name, amount } = req.body || {};
      if (!payer_name || !String(payer_name).trim()) return res.status(400).json({ error: 'Payer / contributor name is required.' });
      if (amount == null || isNaN(Number(amount))) return res.status(400).json({ error: 'A valid amount is required.' });
      const event = await eventModel.findById(req.params.id);
      if (!event) return res.status(404).json({ error: 'Event not found' });
      res.status(201).json(await eventPaymentModel.create({ ...req.body, event_id: req.params.id }));
    } catch (err) { dbError(res, err); }
  },
  async updatePayment(req, res) {
    try {
      const updated = await eventPaymentModel.update(req.params.paymentId, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Payment entry not found' });
      res.json(updated);
    } catch (err) { dbError(res, err); }
  },
  async removePayment(req, res) {
    try {
      const deleted = await eventPaymentModel.remove(req.params.paymentId);
      if (!deleted) return res.status(404).json({ error: 'Payment entry not found' });
      res.json({ success: true, id: deleted.id });
    } catch (err) { dbError(res, err); }
  },

  async addField(req, res) {
    try {
      const { field_key } = req.body || {};
      if (!field_key || !String(field_key).trim()) return res.status(400).json({ error: 'Field name is required.' });
      const event = await eventModel.findById(req.params.id);
      if (!event) return res.status(404).json({ error: 'Event not found' });
      res.status(201).json(await eventFieldModel.create({ ...req.body, event_id: req.params.id }));
    } catch (err) { dbError(res, err); }
  },
  async removeField(req, res) {
    try {
      const deleted = await eventFieldModel.remove(req.params.fieldId);
      if (!deleted) return res.status(404).json({ error: 'Field not found' });
      res.json({ success: true, id: deleted.id });
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notices (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      priority TEXT NOT NULL DEFAULT 'Normal',
      target_wing TEXT,
      pinned BOOLEAN NOT NULL DEFAULT false,
      expires_at DATE,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE notices ADD COLUMN IF NOT EXISTS publish_date DATE;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notice_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      topic TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      priority TEXT NOT NULL DEFAULT 'Normal',
      details TEXT NOT NULL,
      reason TEXT,
      from_name TEXT NOT NULL,
      to_audience TEXT NOT NULL,
      contact TEXT,
      display_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      seen BOOLEAN NOT NULL DEFAULT false,
      notice_id INTEGER REFERENCES notices(id) ON DELETE SET NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notice_reactions (
      id SERIAL PRIMARY KEY,
      notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction TEXT NOT NULL CHECK (reaction IN ('like','dislike')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(notice_id, user_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notice_comments (
      id SERIAL PRIMARY KEY,
      notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'General',
      start_date DATE,
      end_date DATE,
      location TEXT,
      image TEXT,
      status TEXT NOT NULL DEFAULT 'Upcoming',
      budget_total NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_expenses (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      part_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other',
      amount NUMERIC NOT NULL DEFAULT 0,
      day_label TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_payments (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      payer_name TEXT NOT NULL,
      amount NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Pending',
      due_date DATE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_fields (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      field_value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Base/editable content for a festival/event page (title, description,
  // highlights, venue, contact, hero photo, etc.) — edited by the Secretary
  // directly on the live event page via "Website (edit mode)", not through
  // a form. One row per event_slug; any column left NULL falls back to the
  // hardcoded default already baked into event.html's SITE_CONTENT.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_content (
      event_slug TEXT PRIMARY KEY,
      title TEXT,
      teaser TEXT,
      detail TEXT,
      highlights TEXT,
      organized_by TEXT,
      fund_source TEXT,
      venue TEXT,
      when_text TEXT,
      contact TEXT,
      image TEXT,
      start_year INTEGER,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Per-year record for the festival/celebration calendar shown on
  // event.html (Navratri, Diwali, Republic Day, etc. — the static cards
  // on the homepage). event_slug matches the "id" of that event in
  // index.html/event.html's SITE_CONTENT.events list (e.g. 'navratri').
  // One row per (event_slug, year); the year-picker on event.html reads
  // these, and falls back to an estimated figure for any year that has
  // no row here yet.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_year_records (
      id SERIAL PRIMARY KEY,
      event_slug TEXT NOT NULL,
      year INTEGER NOT NULL,
      organized_by TEXT,
      fund_provided BOOLEAN NOT NULL DEFAULT false,
      fund_source TEXT,
      fund_amount NUMERIC,
      budget_required NUMERIC,
      attendance INTEGER,
      image TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(event_slug, year)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS governance_items (
      id SERIAL PRIMARY KEY,
      title TEXT,
      description TEXT,
      link TEXT,
      image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meetings (
      id SERIAL PRIMARY KEY,
      title TEXT,
      description TEXT,
      meeting_date DATE,
      start_time TEXT,
      end_time TEXT,
      location TEXT,
      meeting_link TEXT,
      image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
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
publicRouter.get('/notices', noticesController.publicActive);
publicRouter.get('/events', eventsController.publicList);
publicRouter.get('/governance', governanceController.publicList);
publicRouter.get('/meetings/active', meetingsController.publicActive);
app.use('/api/public', publicRouter);

const maintenanceRouter = express.Router();
maintenanceRouter.get('/', requireSecretary, maintenanceController.byMonth);
maintenanceRouter.get('/mine', requireAuth, maintenanceController.mine);
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

const noticesRouter = express.Router();
// Static-prefixed routes are registered before the '/:id' catch-all so
// e.g. GET /active never gets swallowed by GET /:id/engagement.
noticesRouter.get('/', requireSecretary, noticesController.list);
noticesRouter.get('/active', requireAuth, noticesController.listActive);
noticesRouter.post('/', requireSecretary, noticesController.create);
noticesRouter.delete('/comments/:id', requireAuth, noticesController.removeComment);
noticesRouter.get('/:id/engagement', requireSecretary, noticesController.engagement);
noticesRouter.patch('/:id/pin', requireSecretary, noticesController.setPinned);
noticesRouter.post('/:id/react', requireAuth, noticesController.react);
noticesRouter.post('/:id/comments', requireAuth, noticesController.addComment);
noticesRouter.put('/:id', requireSecretary, noticesController.update);
noticesRouter.delete('/:id', requireSecretary, noticesController.remove);
app.use('/api/notices', noticesRouter);

const noticeRequestsRouter = express.Router();
noticeRequestsRouter.post('/', requireAuth, noticeRequestsController.create);
noticeRequestsRouter.get('/mine', requireAuth, noticeRequestsController.mine);
noticeRequestsRouter.get('/', requireSecretary, noticeRequestsController.list);
noticeRequestsRouter.get('/unseen-count', requireSecretary, noticeRequestsController.unseenCount);
noticeRequestsRouter.post('/mark-seen', requireSecretary, noticeRequestsController.markSeen);
noticeRequestsRouter.patch('/:id/decision', requireSecretary, noticeRequestsController.decide);
noticeRequestsRouter.delete('/:id', requireSecretary, noticeRequestsController.remove);
app.use('/api/notice-requests', noticeRequestsRouter);

const eventsRouter = express.Router();
eventsRouter.get('/', requireSecretary, eventsController.list);
eventsRouter.post('/', requireSecretary, eventsController.create);
eventsRouter.get('/:id/full', requireSecretary, eventsController.full);
eventsRouter.put('/:id', requireSecretary, eventsController.update);
eventsRouter.delete('/:id', requireSecretary, eventsController.remove);
eventsRouter.post('/:id/expenses', requireSecretary, eventsController.addExpense);
eventsRouter.put('/expenses/:expenseId', requireSecretary, eventsController.updateExpense);
eventsRouter.delete('/expenses/:expenseId', requireSecretary, eventsController.removeExpense);
eventsRouter.post('/:id/payments', requireSecretary, eventsController.addPayment);
eventsRouter.put('/payments/:paymentId', requireSecretary, eventsController.updatePayment);
eventsRouter.delete('/payments/:paymentId', requireSecretary, eventsController.removePayment);
eventsRouter.post('/:id/fields', requireSecretary, eventsController.addField);
eventsRouter.delete('/fields/:fieldId', requireSecretary, eventsController.removeField);
app.use('/api/events', eventsRouter);

const governanceRouter = express.Router();
governanceRouter.get('/', requireSecretary, governanceController.list);
governanceRouter.post('/', requireSecretary, governanceController.create);
governanceRouter.put('/:id', requireSecretary, governanceController.update);
governanceRouter.delete('/:id', requireSecretary, governanceController.remove);
app.use('/api/governance', governanceRouter);

const eventYearsRouter = express.Router();
eventYearsRouter.get('/:slug', requireAuth, eventYearController.list);
eventYearsRouter.put('/:slug/:year', requireSecretary, eventYearController.upsert);
eventYearsRouter.delete('/:slug/:year', requireSecretary, eventYearController.remove);
app.use('/api/event-years', eventYearsRouter);

const eventContentRouter = express.Router();
eventContentRouter.get('/:slug', requireAuth, eventContentController.get);
eventContentRouter.put('/:slug', requireSecretary, eventContentController.upsert);
app.use('/api/event-content', eventContentRouter);

const meetingsRouter = express.Router();
meetingsRouter.get('/', requireSecretary, meetingsController.list);
meetingsRouter.get('/active', requireSecretary, meetingsController.active);
meetingsRouter.post('/', requireSecretary, meetingsController.create);
meetingsRouter.put('/:id', requireSecretary, meetingsController.update);
meetingsRouter.delete('/:id', requireSecretary, meetingsController.remove);
app.use('/api/meetings', meetingsRouter);

// =====================================================================
// Quick Actions backend: society settings, complaints, community-hall
// bookings and visitor gate passes. Resident endpoints are scoped to the
// caller's own flat; every "all records" endpoint is Secretary-only.
// =====================================================================
const crypto = require('crypto');

const QA_PUBLIC_SETTINGS = ['hall_fee', 'hall_capacity', 'hall_rules'];
const QA_MEMBER_SETTINGS = ['maintenance_amount', 'maintenance_due_day', 'payee_name', 'upi_id', 'bank_details'];
const QA_DEFAULTS = {
  hall_rules: 'Bookings are confirmed only after the Secretary approves them.\nNo loud music after 10 PM.\nPlease leave the hall clean; damage charges may apply.'
};
const COMPLAINT_CATEGORIES = ['Plumbing', 'Electrical', 'Lift', 'Water supply', 'Security', 'Cleaning', 'Parking', 'Noise', 'Other'];
const COMPLAINT_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
const COMPLAINT_STATUSES = ['Open', 'In Progress', 'Resolved', 'Rejected'];
const HALL_SLOTS = { morning: 'Morning (8 AM – 1 PM)', evening: 'Evening (4 PM – 11 PM)', full: 'Full day' };
const GATE_STATUSES = ['Active', 'Checked In', 'Checked Out', 'Cancelled'];

async function migrateQuickActions() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS society_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      raised_by TEXT NOT NULL,
      wing TEXT NOT NULL,
      flat TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other',
      priority TEXT NOT NULL DEFAULT 'Normal',
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'Open',
      secretary_reply TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hall_bookings (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      booked_by TEXT NOT NULL,
      wing TEXT NOT NULL,
      flat TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'Other',
      booking_date DATE NOT NULL,
      slot TEXT NOT NULL,
      guests INTEGER NOT NULL DEFAULT 1,
      purpose TEXT,
      status TEXT NOT NULL DEFAULT 'Pending',
      secretary_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gate_passes (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      requested_by TEXT NOT NULL,
      wing TEXT NOT NULL,
      flat TEXT NOT NULL,
      visitor_name TEXT NOT NULL,
      visitor_phone TEXT,
      purpose TEXT,
      vehicle_no TEXT,
      visit_date DATE NOT NULL,
      time_window TEXT,
      pass_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      checked_in_at TIMESTAMPTZ,
      checked_out_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// Who is acting? A resident acts as their own flat. The Secretary account
// has no flat of its own, so it must say which flat it is acting for.
async function qaIdentity(req) {
  if (req.session.memberId) {
    const m = await memberModel.findById(req.session.memberId);
    if (m) return { memberId: m.id, name: m.name, wing: m.wing, flat: m.flat };
  }
  if (req.session.role === ROLES.SECRETARY) {
    const b = req.body || {};
    if (WINGS.includes(b.wing) && b.flat && String(b.flat).trim()) {
      const who = String(b.on_behalf_of || '').trim().slice(0, 80);
      return { memberId: null, name: who ? who + ' (via Secretary)' : 'Resident (via Secretary)', wing: b.wing, flat: String(b.flat).trim().slice(0, 20) };
    }
    return { error: 'Choose the wing and flat you are acting for.' };
  }
  return { error: 'Your account is not linked to a flat yet. Please contact the Secretary.' };
}

const qaClean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const qaDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const DATE_SQL = (col) => `to_char(${col}, 'YYYY-MM-DD')`;

const settingsController = {
  async get(req, res) {
    try {
      const { rows } = await pool.query('SELECT key, value FROM society_settings');
      const all = Object.assign({}, QA_DEFAULTS);
      rows.forEach(r => { all[r.key] = r.value; });
      const keys = req.session && req.session.userId ? QA_PUBLIC_SETTINGS.concat(QA_MEMBER_SETTINGS) : QA_PUBLIC_SETTINGS;
      const out = {};
      keys.forEach(k => { out[k] = all[k] || ''; });
      res.json(out);
    } catch (err) { dbError(res, err); }
  },
  async save(req, res) {
    try {
      const allowed = QA_PUBLIC_SETTINGS.concat(QA_MEMBER_SETTINGS);
      const body = req.body || {};
      for (const key of allowed) {
        if (body[key] === undefined) continue;
        await pool.query(
          `INSERT INTO society_settings (key, value, updated_at) VALUES ($1,$2, now())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
          [key, qaClean(body[key], 1000)]
        );
      }
      res.json({ success: true });
    } catch (err) { dbError(res, err); }
  }
};

const complaintsController = {
  async create(req, res) {
    try {
      const who = await qaIdentity(req);
      if (who.error) return res.status(400).json({ error: who.error });
      const b = req.body || {};
      const title = qaClean(b.title, 120);
      if (title.length < 3) return res.status(400).json({ error: 'Please give the complaint a short title.' });
      const category = COMPLAINT_CATEGORIES.includes(b.category) ? b.category : 'Other';
      const priority = COMPLAINT_PRIORITIES.includes(b.priority) ? b.priority : 'Normal';
      const { rows } = await pool.query(
        `INSERT INTO complaints (member_id, raised_by, wing, flat, category, priority, title, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [who.memberId, who.name, who.wing, who.flat, category, priority, title, qaClean(b.description, 2000)]
      );
      res.status(201).json(rows[0]);
    } catch (err) { dbError(res, err); }
  },
  async mine(req, res) {
    try {
      if (!req.session.memberId) return res.json([]);
      const { rows } = await pool.query('SELECT * FROM complaints WHERE member_id = $1 ORDER BY created_at DESC LIMIT 50', [req.session.memberId]);
      res.json(rows);
    } catch (err) { dbError(res, err); }
  },
  async list(req, res) {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM complaints
         ORDER BY CASE status WHEN 'Open' THEN 0 WHEN 'In Progress' THEN 1 ELSE 2 END,
                  CASE priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END,
                  created_at DESC
         LIMIT 300`
      );
      const stat = await pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status='Open')::int AS open,
                COUNT(*) FILTER (WHERE status='In Progress')::int AS in_progress,
                COUNT(*) FILTER (WHERE status='Resolved')::int AS resolved,
                COUNT(*) FILTER (WHERE status='Rejected')::int AS rejected,
                COUNT(*) FILTER (WHERE priority='Urgent' AND status IN ('Open','In Progress'))::int AS urgent_open,
                ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) FILTER (WHERE status='Resolved')::numeric, 1) AS avg_resolution_hours
         FROM complaints`
      );
      res.json({ stats: stat.rows[0], items: rows });
    } catch (err) { dbError(res, err); }
  },
  async update(req, res) {
    try {
      const b = req.body || {};
      if (!COMPLAINT_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status.' });
      const closed = b.status === 'Resolved' || b.status === 'Rejected';
      const { rows } = await pool.query(
        `UPDATE complaints SET status = $1, secretary_reply = $2, updated_at = now(),
                resolved_at = CASE WHEN $3 THEN COALESCE(resolved_at, now()) ELSE NULL END
         WHERE id = $4 RETURNING *`,
        [b.status, qaClean(b.reply, 1000), closed, req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Complaint not found.' });
      res.json(rows[0]);
    } catch (err) { dbError(res, err); }
  }
};

// Overlap rule: a full-day booking clashes with everything, otherwise only
// the same slot clashes.
async function hallConflict(date, slot, ignoreId) {
  const { rows } = await pool.query(
    `SELECT id FROM hall_bookings
     WHERE booking_date = $1 AND status = 'Approved' AND id <> $2
       AND (slot = $3 OR slot = 'full' OR $3 = 'full') LIMIT 1`,
    [date, ignoreId || 0, slot]
  );
  return rows.length > 0;
}
const HALL_COLS = `id, member_id, booked_by, wing, flat, event_type, ${DATE_SQL('booking_date')} AS booking_date, slot, guests, purpose, status, secretary_note, created_at, decided_at`;

const hallController = {
  async calendar(req, res) {
    try {
      const month = String(req.query.month || '');
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month is required, format YYYY-MM' });
      const { rows } = await pool.query(
        `SELECT ${DATE_SQL('booking_date')} AS date, slot FROM hall_bookings
         WHERE status = 'Approved' AND to_char(booking_date,'YYYY-MM') = $1`, [month]
      );
      res.json(rows);
    } catch (err) { dbError(res, err); }
  },
  async create(req, res) {
    try {
      const who = await qaIdentity(req);
      if (who.error) return res.status(400).json({ error: who.error });
      const b = req.body || {};
      const date = qaDate(b.date);
      if (!date) return res.status(400).json({ error: 'Please pick a date.' });
      if (!HALL_SLOTS[b.slot]) return res.status(400).json({ error: 'Please pick a time slot.' });
      const { rows: chk } = await pool.query(`SELECT ($1::date >= CURRENT_DATE AND $1::date <= CURRENT_DATE + 365) AS ok`, [date]);
      if (!chk[0].ok) return res.status(400).json({ error: 'Choose a date from today up to one year ahead.' });
      const guests = Math.max(1, parseInt(b.guests, 10) || 1);
      const { rows: cap } = await pool.query(`SELECT value FROM society_settings WHERE key = 'hall_capacity'`);
      const capacity = cap[0] ? parseInt(cap[0].value, 10) : 0;
      if (capacity && guests > capacity) return res.status(400).json({ error: `The hall holds up to ${capacity} guests.` });
      if (await hallConflict(date, b.slot)) return res.status(409).json({ error: 'That date and slot is already booked. Please choose another.' });
      const { rows: dup } = await pool.query(
        `SELECT 1 FROM hall_bookings WHERE wing=$1 AND flat=$2 AND booking_date=$3 AND slot=$4 AND status='Pending'`,
        [who.wing, who.flat, date, b.slot]
      );
      if (dup.length) return res.status(409).json({ error: 'You already have a pending request for this slot.' });
      const { rows } = await pool.query(
        `INSERT INTO hall_bookings (member_id, booked_by, wing, flat, event_type, booking_date, slot, guests, purpose)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${HALL_COLS}`,
        [who.memberId, who.name, who.wing, who.flat, qaClean(b.event_type, 60) || 'Other', date, b.slot, guests, qaClean(b.purpose, 500)]
      );
      res.status(201).json(rows[0]);
    } catch (err) { dbError(res, err); }
  },
  async mine(req, res) {
    try {
      if (!req.session.memberId) return res.json([]);
      const { rows } = await pool.query(`SELECT ${HALL_COLS} FROM hall_bookings WHERE member_id = $1 ORDER BY booking_date DESC LIMIT 30`, [req.session.memberId]);
      res.json(rows);
    } catch (err) { dbError(res, err); }
  },
  async cancel(req, res) {
    try {
      const { rows: found } = await pool.query('SELECT member_id, status FROM hall_bookings WHERE id = $1', [req.params.id]);
      if (!found[0]) return res.status(404).json({ error: 'Booking not found.' });
      const isOwner = req.session.memberId && found[0].member_id === req.session.memberId;
      if (!isOwner && req.session.role !== ROLES.SECRETARY) return res.status(403).json({ error: 'You can only cancel your own booking.' });
      if (!['Pending', 'Approved'].includes(found[0].status)) return res.status(400).json({ error: 'This booking can no longer be cancelled.' });
      const { rows } = await pool.query(`UPDATE hall_bookings SET status='Cancelled', decided_at=now() WHERE id=$1 RETURNING ${HALL_COLS}`, [req.params.id]);
      res.json(rows[0]);
    } catch (err) { dbError(res, err); }
  },
  async list(req, res) {
    try {
      const { rows } = await pool.query(
        `SELECT ${HALL_COLS},
           EXISTS (SELECT 1 FROM hall_bookings o WHERE o.status='Approved' AND o.booking_date = h.booking_date AND o.id <> h.id
                   AND (o.slot = h.slot OR o.slot='full' OR h.slot='full')) AS has_conflict
         FROM hall_bookings h
         ORDER BY CASE status WHEN 'Pending' THEN 0 WHEN 'Approved' THEN 1 ELSE 2 END,
                  CASE WHEN booking_date >= CURRENT_DATE THEN 0 ELSE 1 END, booking_date ASC
         LIMIT 300`
      );
      const stat = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE status='Pending')::int AS pending,
                COUNT(*) FILTER (WHERE status='Approved' AND booking_date >= CURRENT_DATE)::int AS upcoming,
                COUNT(*) FILTER (WHERE status='Approved' AND to_char(booking_date,'YYYY-MM') = to_char(CURRENT_DATE,'YYYY-MM'))::int AS this_month,
                COUNT(*)::int AS total
         FROM hall_bookings`
      );
      res.json({ stats: stat.rows[0], items: rows });
    } catch (err) { dbError(res, err); }
  },
  async decide(req, res) {
    try {
      const b = req.body || {};
      if (!['approve', 'reject'].includes(b.decision)) return res.status(400).json({ error: 'decision must be approve or reject' });
      const { rows: found } = await pool.query(`SELECT ${HALL_COLS} FROM hall_bookings WHERE id = $1`, [req.params.id]);
      if (!found[0]) return res.status(404).json({ error: 'Booking not found.' });
      if (found[0].status !== 'Pending') return res.status(400).json({ error: 'Only pending requests can be decided.' });
      if (b.decision === 'approve' && await hallConflict(found[0].booking_date, found[0].slot, found[0].id)) {
        return res.status(409).json({ error: 'Another approved booking already covers this slot.' });
      }
      const { rows } = await pool.query(
        `UPDATE hall_bookings SET status=$1, secretary_note=$2, decided_at=now() WHERE id=$3 RETURNING ${HALL_COLS}`,
        [b.decision === 'approve' ? 'Approved' : 'Rejected', qaClean(b.note, 500), req.params.id]
      );
      res.json(rows[0]);
    } catch (err) { dbError(res, err); }
  }
};

const GATE_COLS = `id, member_id, requested_by, wing, flat, visitor_name, visitor_phone, purpose, vehicle_no, ${DATE_SQL('visit_date')} AS visit_date, time_window, pass_code, status, checked_in_at, checked_out_at, created_at`;

const gatePassController = {
  async create(req, res) {
    try {
      const who = await qaIdentity(req);
      if (who.error) return res.status(400).json({ error: who.error });
      const b = req.body || {};
      const visitor = qaClean(b.visitor_name, 80);
      if (visitor.length < 2) return res.status(400).json({ error: "Please enter the visitor's name." });
      const date = qaDate(b.visit_date);
      if (!date) return res.status(400).json({ error: 'Please pick the visit date.' });
      const { rows: chk } = await pool.query(`SELECT ($1::date >= CURRENT_DATE AND $1::date <= CURRENT_DATE + 30) AS ok`, [date]);
      if (!chk[0].ok) return res.status(400).json({ error: 'Choose a date from today up to 30 days ahead.' });
      const phone = qaClean(b.visitor_phone, 20);
      if (phone && !/^[0-9+\-\s]{7,20}$/.test(phone)) return res.status(400).json({ error: 'Visitor phone looks invalid.' });
      const code = String(crypto.randomInt(100000, 1000000));
      const { rows } = await pool.query(
        `INSERT INTO gate_passes (member_id, requested_by, wing, flat, visitor_name, visitor_phone, purpose, vehicle_no, visit_date, time_window, pass_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${GATE_COLS}`,
        [who.memberId, who.name, who.wing, who.flat, visitor, phone, qaClean(b.purpose, 120), qaClean(b.vehicle_no, 20).toUpperCase(), date, qaClean(b.time_window, 60), code]
      );
      res.status(201).json(rows[0]);
    } catch (err) { dbError(res, err); }
  },
  async mine(req, res) {
    try {
      if (!req.session.memberId) return res.json([]);
      const { rows } = await pool.query(`SELECT ${GATE_COLS} FROM gate_passes WHERE member_id = $1 ORDER BY visit_date DESC, created_at DESC LIMIT 30`, [req.session.memberId]);
      res.json(rows);
    } catch (err) { dbError(res, err); }
  },
  async cancel(req, res) {
    try {
      const { rows: found } = await pool.query('SELECT member_id, status FROM gate_passes WHERE id = $1', [req.params.id]);
      if (!found[0]) return res.status(404).json({ error: 'Pass not found.' });
      const isOwner = req.session.memberId && found[0].member_id === req.session.memberId;
      if (!isOwner && req.session.role !== ROLES.SECRETARY) return res.status(403).json({ error: 'You can only cancel your own pass.' });
      if (found[0].status !== 'Active') return res.status(400).json({ error: 'Only an unused pass can be cancelled.' });
      const { rows } = await pool.query(`UPDATE gate_passes SET status='Cancelled' WHERE id=$1 RETURNING ${GATE_COLS}`, [req.params.id]);
      res.json(rows[0]);
    } catch (err) { dbError(res, err); }
  },
  async list(req, res) {
    try {
      const { rows } = await pool.query(
        `SELECT ${GATE_COLS} FROM gate_passes
         ORDER BY visit_date DESC, created_at DESC LIMIT 300`
      );
      const stat = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE visit_date = CURRENT_DATE AND status <> 'Cancelled')::int AS today_total,
                COUNT(*) FILTER (WHERE visit_date = CURRENT_DATE AND status = 'Active')::int AS today_expected,
                COUNT(*) FILTER (WHERE status = 'Checked In')::int AS inside_now,
                COUNT(*) FILTER (WHERE visit_date = CURRENT_DATE AND status = 'Checked Out')::int AS today_done
         FROM gate_passes`
      );
      res.json({ stats: stat.rows[0], items: rows });
    } catch (err) { dbError(res, err); }
  },
  async setStatus(req, res) {
    try {
      const status = (req.body || {}).status;
      if (!GATE_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
      const { rows } = await pool.query(
        `UPDATE gate_passes SET status = $1::text,
           checked_in_at  = CASE WHEN $1::text = 'Checked In'  THEN now() WHEN $1::text = 'Active' THEN NULL ELSE checked_in_at END,
           checked_out_at = CASE WHEN $1::text = 'Checked Out' THEN now() WHEN $1::text IN ('Active','Checked In') THEN NULL ELSE checked_out_at END
         WHERE id = $2 RETURNING ${GATE_COLS}`,
        [status, req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Pass not found.' });
      res.json(rows[0]);
    } catch (err) { dbError(res, err); }
  }
};

const settingsRouter = express.Router();
settingsRouter.get('/', settingsController.get);
settingsRouter.put('/', requireSecretary, settingsController.save);
app.use('/api/settings', settingsRouter);

const complaintsRouter = express.Router();
complaintsRouter.post('/', requireAuth, complaintsController.create);
complaintsRouter.get('/mine', requireAuth, complaintsController.mine);
complaintsRouter.get('/', requireSecretary, complaintsController.list);
complaintsRouter.patch('/:id', requireSecretary, complaintsController.update);
app.use('/api/complaints', complaintsRouter);

const hallRouter = express.Router();
hallRouter.get('/calendar', hallController.calendar);
hallRouter.post('/', requireAuth, hallController.create);
hallRouter.get('/mine', requireAuth, hallController.mine);
hallRouter.get('/', requireSecretary, hallController.list);
hallRouter.patch('/:id/cancel', requireAuth, hallController.cancel);
hallRouter.patch('/:id/decision', requireSecretary, hallController.decide);
app.use('/api/hall-bookings', hallRouter);

const gatePassRouter = express.Router();
gatePassRouter.post('/', requireAuth, gatePassController.create);
gatePassRouter.get('/mine', requireAuth, gatePassController.mine);
gatePassRouter.get('/', requireSecretary, gatePassController.list);
gatePassRouter.patch('/:id/cancel', requireAuth, gatePassController.cancel);
gatePassRouter.patch('/:id/status', requireSecretary, gatePassController.setStatus);
app.use('/api/gate-passes', gatePassRouter);

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
    await migrateQuickActions();
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