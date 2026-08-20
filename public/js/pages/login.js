import { api } from '../utils/api.js';

const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');
const submitBtn = document.getElementById('loginSubmitBtn');

// If we were redirected here from a page that requires login (e.g. the
// homepage itself), ?next=... tells us where to send the user back to
// once they're signed in. Only a plain relative path is ever honoured —
// never a full URL — so this can't be used to redirect off-site.
function safeNextUrl() {
  const next = new URLSearchParams(window.location.search).get('next');
  if (!next) return null;
  if (/^https?:\/\//i.test(next) || next.startsWith('//')) return null;
  if (!/^[a-zA-Z0-9_\-./]/.test(next)) return null;
  return next;
}

// Carry ?next=... through to the "Create an account" link too, so a
// resident who signs up (instead of logging in) also lands back on the
// page that originally sent them here.
const nextParam = new URLSearchParams(window.location.search).get('next');
if (nextParam) {
  const switchLink = document.querySelector('.auth-switch a');
  if (switchLink) switchLink.href = `signup.html?next=${encodeURIComponent(nextParam)}`;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.add('show');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.remove('show');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in…';

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: {
        email: document.getElementById('loginEmail').value.trim(),
        password: document.getElementById('loginPassword').value,
        rememberMe: document.getElementById('loginRemember').checked
      }
    });
    const fallback = data.user.role === 'secretary' ? 'secretary.html' : 'index.html';
    window.location.href = safeNextUrl() || fallback;
  } catch (err) {
    showError(err.message || 'Could not log in. Please try again.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Log in';
  }
});
