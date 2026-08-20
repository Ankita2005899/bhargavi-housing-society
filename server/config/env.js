// Centralised environment configuration. Every other module reads
// settings from here instead of touching process.env directly, so all
// the defaults and required-value checks live in exactly one place.

const required = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
};

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  databaseUrl: process.env.DATABASE_URL || '',

  sessionSecret: required('SESSION_SECRET', 'bhs-dev-secret-change-me'),
  sessionMaxAgeMs: 1000 * 60 * 60 * 4,        // 4 hours (default session)
  sessionRememberMaxAgeMs: 1000 * 60 * 60 * 24 * 30, // 30 days ("remember me")

  // Bootstrap secretary account — created automatically on first boot if
  // no secretary user exists yet. Change these via Render environment
  // variables; the password is hashed before it ever touches the database.
  secretaryEmail: required('SECRETARY_EMAIL', 'secratory2@gmail.com'),
  secretaryPassword: required('SECRETARY_PASSWORD', '123456')
};
