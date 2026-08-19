# Architecture notes

## Accounts and roles

One `users` table holds every login: `email`, `password_hash`, `role`
(`'secretary'` or `'resident'`), and `member_id` (which row in `members`
this account belongs to — `NULL` for the Secretary).

- The **Secretary** account is created once, automatically, the first
  time the server boots against an empty database
  (`server/db/seeds/secretaryAccount.seed.js`), using
  `SECRETARY_EMAIL` / `SECRETARY_PASSWORD` from the environment.
- **Resident** accounts are created through `POST /api/auth/signup`
  (`server/controllers/auth.controller.js`). Sign-up asks for name,
  wing, flat, email and password; every login after that only needs
  email + password.

## How permission checks work

Everything funnels through `server/middleware/auth.js`:

- `requireAuth` — must be logged in (any role).
- `requireSecretary` — must be logged in **as the Secretary**. Used on
  every route that touches finance, projects, the full member list,
  staff, hospitals/ambulances management, and maintenance.
- `requireSelfOrSecretary` — used only on
  `GET /api/members/:id/profile`. Lets the request through if the
  session is the Secretary, **or** if the session's own `member_id`
  matches the `:id` in the URL. Anyone else gets `403 Forbidden`
  straight from the server — the client-side UI never even receives
  the data to hide.

This is the piece that satisfies "a resident can only see their own
details, the Secretary can see everyone's": it's enforced in one place,
on the server, not scattered across the front end.

## Public vs. gated data

Two members endpoints exist on purpose:

- `GET /api/public/members` — no login required, returns only
  `id, name, wing, flat, profile_image, status`. This is what powers
  the browsable directory in the "View Details" popup.
- `GET /api/members/:id/profile` — gated by `requireSelfOrSecretary`,
  returns every field (phone, email, address, Aadhaar, occupation,
  dues). This is what opens when someone clicks a member in the popup.

The front end (`public/js/components/detailsPopup.js`) reflects this:
if you're not logged in, clicking a member shows a "log in to view
details" prompt instead of calling the profile endpoint at all; if
you're a resident and it isn't your own record, it shows "you can only
view your own profile" instead of opening anything.

## Adding a new resource (e.g. a "Visitors" log)

Follow the existing pattern for any of `finance`, `projects`,
`hospitals`, etc.:

1. `server/db/migrate.js` — add the `CREATE TABLE IF NOT EXISTS`.
2. `server/models/visitor.model.js` — the SQL queries.
3. `server/controllers/visitors.controller.js` — request handling.
4. `server/routes/visitors.routes.js` — wire routes to controller +
   the right middleware (`requireSecretary` unless residents should
   see it too).
5. Mount it in `server/app.js`: `app.use('/api/visitors', visitorRoutes)`.
6. Add the UI in `secretary.html` / `public/js/pages/secretary.js`
   following the existing tab pattern.
