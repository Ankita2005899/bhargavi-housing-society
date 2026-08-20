import { api } from '../utils/api.js';

const form = document.getElementById('signupForm');
const errorEl = document.getElementById('signupError');
const submitBtn = document.getElementById('signupSubmitBtn');

// Same ?next=... handling as login.js — see there for why.
function safeNextUrl() {
  const next = new URLSearchParams(window.location.search).get('next');
  if (!next) return null;
  if (/^https?:\/\//i.test(next) || next.startsWith('//')) return null;
  if (!/^[a-zA-Z0-9_\-./]/.test(next)) return null;
  return next;
}

const nextParam = new URLSearchParams(window.location.search).get('next');
if (nextParam) {
  const switchLink = document.querySelector('.auth-switch a');
  if (switchLink) switchLink.href = `login.html?next=${encodeURIComponent(nextParam)}`;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.add('show');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.remove('show');

  const password = document.getElementById('suPassword').value;
  const confirmPassword = document.getElementById('suConfirm').value;
  if (password !== confirmPassword) {
    return showError('Passwords do not match.');
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account…';

  try {
    await api('/api/auth/signup', {
      method: 'POST',
      body: {
        name: document.getElementById('suName').value.trim(),
        wing: document.getElementById('suWing').value,
        flat: document.getElementById('suFlat').value.trim(),
        email: document.getElementById('suEmail').value.trim(),
        password,
        confirmPassword
      }
    });
    window.location.href = safeNextUrl() || 'index.html';
  } catch (err) {
    showError(err.message || 'Could not create the account. Please try again.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create account';
  }
});
