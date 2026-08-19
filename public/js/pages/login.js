import { api } from '../utils/api.js';

const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');
const submitBtn = document.getElementById('loginSubmitBtn');

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
    window.location.href = data.user.role === 'secretary' ? 'secretary.html' : 'index.html';
  } catch (err) {
    showError(err.message || 'Could not log in. Please try again.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Log in';
  }
});
