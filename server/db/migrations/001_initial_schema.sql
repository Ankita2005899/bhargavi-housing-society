-- Bhargavi Housing Society — initial schema.
-- Applied automatically on server boot by server/db/migrate.js, kept
-- here in .sql form as well so it can be reviewed or run by hand.

CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  wing TEXT NOT NULL,
  flat TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  dues TEXT NOT NULL DEFAULT 'Dues paid',
  profile_image TEXT,
  email TEXT,
  phone_2 TEXT,
  address_1 TEXT,
  address_2 TEXT,
  aadhaar_number TEXT,
  occupation TEXT,
  business TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Login accounts. Every account is either the Secretary (role =
-- 'secretary', member_id NULL) or a resident tied to exactly one member
-- record (role = 'resident', member_id NOT NULL).
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'resident',
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance (
  id SERIAL PRIMARY KEY,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  type TEXT NOT NULL DEFAULT 'Expense',
  amount NUMERIC NOT NULL DEFAULT 0,
  entry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'Planned',
  budget NUMERIC NOT NULL DEFAULT 0,
  spent NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hospitals (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone_main TEXT,
  phone_staff TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ambulances (
  id SERIAL PRIMARY KEY,
  service_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  eta_minutes INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS maintenance_payments (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Unpaid',
  screenshot TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(member_id, month)
);
