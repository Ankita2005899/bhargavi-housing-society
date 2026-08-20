// Renders the login state into the header/slide-menu account slot, and
// swaps the "Secretary Section" trigger for a straight link once we know
// whether the signed-in account actually is the Secretary.

import { api } from '../utils/api.js';
import { icon } from '../utils/icons.js';

let cachedSession = null;

// Shared by other components (detailsPopup) so everyone reads the same
// session instead of firing their own /api/auth/session request.
export async function getSession(force) {
  if (cachedSession && !force) return cachedSession;
  try { cachedSession = await api('/api/auth/session'); }
  catch (err) { cachedSession = { loggedIn: false }; }
  return cachedSession;
}

export async function initAccountMenu() {
  // The header (front of the site, always visible) is now where login /
  // signup / account state lives — it used to be tucked inside the
  // hamburger slide-menu, but residents shouldn't have to open a menu
  // just to sign in.
  const slot = document.getElementById('headerAuthSlot');
  const secretaryTrigger = document.getElementById('secretaryBtn');
  if (!slot) return;

  const s = await getSession(true);

  if (!s.loggedIn) {
    slot.innerHTML = `
      <a href="login.html" class="btn btn-outline btn-sm">Log in</a>
      <a href="signup.html" class="btn btn-primary btn-sm auth-signup-btn">Sign up</a>`;
    if (secretaryTrigger) secretaryTrigger.style.display = 'none';
    return;
  }

  const label = s.role === 'secretary' ? 'Secretary' : 'Resident';
  slot.innerHTML = `
    <span class="account-pill">${icon('user', 15)} ${label}</span>
    <button class="btn btn-outline btn-sm" id="logoutBtn">${icon('logout', 14)} Log out</button>`;

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    cachedSession = null;
    window.location.reload();
  });

  // The "Secretary Section" entry only appears at all for the account
  // that's actually logged in as the Secretary — anyone else (logged
  // out, or a resident account) never sees it in the menu.
  if (secretaryTrigger) {
    if (s.role === 'secretary') {
      secretaryTrigger.style.display = '';
      secretaryTrigger.querySelector('small').textContent = 'Open the dashboard';
      secretaryTrigger.addEventListener('click', () => { window.location.href = 'secretary.html'; });
    } else {
      secretaryTrigger.style.display = 'none';
    }
  }
}
