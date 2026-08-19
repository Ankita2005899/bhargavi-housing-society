const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

// Any Gmail address is accepted as long as it's a well-formed email —
// residents may use a work/other email too, so this only warns the
// front end, it never blocks a valid non-Gmail address server-side.
function isGmail(email) {
  return isValidEmail(email) && /@gmail\.com$/i.test(email.trim());
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 6;
}

const REQUIRED_MEMBER_FIELDS = ['name', 'wing', 'flat', 'email', 'phone', 'phone_2', 'address_1', 'address_2', 'aadhaar_number', 'occupation'];

function validateMemberBody(body) {
  const missing = REQUIRED_MEMBER_FIELDS.filter(f => !String(body[f] || '').trim());
  if (missing.length) return `Missing required field(s): ${missing.join(', ')}`;
  const aadhaar = String(body.aadhaar_number).replace(/\s+/g, '');
  if (!/^\d{12}$/.test(aadhaar)) return 'Aadhaar number must be exactly 12 digits';
  return null;
}

module.exports = { isValidEmail, isGmail, isValidPassword, validateMemberBody, REQUIRED_MEMBER_FIELDS };
