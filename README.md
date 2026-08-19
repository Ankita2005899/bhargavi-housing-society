# Bhargavi Housing Society — Resident & Secretary Portal

A society website with a public homepage, resident sign-up/login, and a
Secretary dashboard for managing members, finance, projects, maintenance,
hospitals, ambulances and staff/vendors.

## What's new in this version

- **Accounts, not a shared password.** Residents sign up with their name,
  wing, flat, email and a password. From then on, logging in only asks
  for **email + password** (see `views/login.html`).
- **Two roles, enforced on the server:**
  - **Secretary** — full access to every member's details and the whole
    dashboard.
  - **Resident** — can only open **their own** member profile. Clicking
    another resident's card in the "View Details" popup is refused by
    the server (`403 Forbidden`), not just hidden in the UI.
- **Professional "View Details" popup** — the old emoji list is now a
  proper directory (wing → room → member, with photo avatars, status
  tags, and clean SVG icons instead of 🚑🏥👤).
- **Reorganised into a real project layout** — see below.

## Project layout

```
bhargavi-housing-society/
├── server/                 Express backend
│   ├── config/              env vars + the Postgres pool
│   ├── constants/           shared constants (roles)
│   ├── controllers/         one file per resource — request handling
│   ├── db/
│   │   ├── migrations/      schema.sql (reference copy)
│   │   └── seeds/           demo data + the Secretary bootstrap account
│   ├── middleware/          auth checks + error handling
│   ├── models/               one file per resource — SQL queries
│   ├── routes/               one file per resource — URL → controller
│   ├── utils/                 password hashing, validation
│   ├── app.js                assembles the Express app
│   └── server.js             entry point (`npm start` runs this)
├── public/                  static assets served as-is
│   ├── css/
│   │   ├── base/              design tokens (colours, type, radius)
│   │   ├── components/        reusable pieces (popup, etc.)
│   │   └── pages/              per-page styling
│   ├── js/
│   │   ├── pages/              one script per HTML page
│   │   ├── components/         shared UI pieces (popup, account menu)
│   │   └── utils/               fetch helper, icons, small helpers
│   ├── icons/                (reserved for future standalone icon assets)
│   └── images/
│       ├── branding/           logo, gate photo
│       └── gallery/             event/wing photos
├── views/                    the HTML pages themselves
├── docs/                     architecture notes (see docs/ARCHITECTURE.md)
└── scripts/                  (reserved for future maintenance scripts)
```

## Running it locally

```bash
npm install
cp .env.example .env      # then fill in DATABASE_URL at minimum
npm start
```

The server creates all tables automatically on first boot (safe to run
against an existing database — it only adds what's missing), seeds a
little demo data if the tables are empty, and creates the Secretary
login from `SECRETARY_EMAIL` / `SECRETARY_PASSWORD` in your `.env`.

Open `http://localhost:3000`, then:
- **Secretary:** go to `login.html` and sign in with `SECRETARY_EMAIL`
  / `SECRETARY_PASSWORD` — you'll land on the dashboard.
- **Resident:** go to `signup.html`, fill in your name/wing/flat/email/
  password. If the Secretary already added your member record, your
  account links to it automatically; otherwise a basic one is created
  for the Secretary to fill in later.

## Deploying on Render

Nothing changes about how you deploy — same `npm start`, same
`DATABASE_URL`, plus the two new variables from `.env.example`
(`SESSION_SECRET`, `SECRETARY_EMAIL`, `SECRETARY_PASSWORD`) added under
Render's **Environment** tab.

## Notes

- `bcryptjs` (pure JavaScript) is used for password hashing instead of
  `bcrypt`, so there's no native build step for Render's default image.
- See `docs/ARCHITECTURE.md` for how the permission system works.
