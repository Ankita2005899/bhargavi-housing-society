const express = require('express');
const path = require('path');
const session = require('express-session');

const env = require('./config/env');
const migrate = require('./db/migrate');
const runSeeds = require('./db/seeds');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const memberRoutes = require('./routes/members.routes');
const publicRoutes = require('./routes/public.routes');
const maintenanceRoutes = require('./routes/maintenance.routes');
const financeRoutes = require('./routes/finance.routes');
const projectRoutes = require('./routes/projects.routes');
const hospitalRoutes = require('./routes/hospitals.routes');
const ambulanceRoutes = require('./routes/ambulances.routes');
const staffRoutes = require('./routes/staff.routes');

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
app.use('/api/auth', authRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/hospitals', hospitalRoutes);
app.use('/api/ambulances', ambulanceRoutes);
app.use('/api/staff', staffRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', society: 'Bhargavi Housing Society' });
});

// ---------------------------------------------------------------------
// Static site — HTML pages live in /views, assets in /public
// ---------------------------------------------------------------------
const ROOT = path.join(__dirname, '..');
app.use(express.static(path.join(ROOT, 'public')));
app.use(express.static(path.join(ROOT, 'views')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(ROOT, 'views', 'index.html'));
});

app.use(errorHandler);

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

module.exports = { app, start };
