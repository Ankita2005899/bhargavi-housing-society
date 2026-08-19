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
  const slot = document.getElementById('accountSlot');
  const secretaryTrigger = document.getElementById('secretaryBtn');
  if (!slot) return;

  const s = await getSession(true);

  if (!s.loggedIn) {
    slot.innerHTML = `
      <a href="login.html" class="btn btn-outline btn-sm">Log in</a>
      <a href="signup.html" class="btn btn-primary btn-sm">Sign up</a>`;
    if (secretaryTrigger) {
      secretaryTrigger.querySelector('small').textContent = 'Committee access only — please log in';
    }
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

  if (secretaryTrigger) {
    if (s.role === 'secretary') {
      secretaryTrigger.querySelector('small').textContent = 'Open the dashboard';
      secretaryTrigger.addEventListener('click', () => { window.location.href = 'secretary.html'; });
    } else {
      secretaryTrigger.querySelector('small').textContent = 'Committee access only';
      secretaryTrigger.addEventListener('click', (e) => {
        e.preventDefault();
        secretaryTrigger.classList.add('shake');
        setTimeout(() => secretaryTrigger.classList.remove('shake'), 500);
      });
    }
  }
}
