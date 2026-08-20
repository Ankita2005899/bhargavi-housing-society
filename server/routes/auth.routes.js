const express = require('express');
const router = express.Router();
const auth = require('../controllers/auth.controller');
const { requireAuth, requireSecretary } = require('../middleware/auth');

router.post('/signup', auth.signup);
router.post('/login', auth.login);
router.post('/logout', auth.logout);
router.get('/session', auth.session);

// Secretary-section-only: registered accounts + login history.
router.get('/accounts', requireAuth, requireSecretary, auth.listAccounts);
router.get('/login-history', requireAuth, requireSecretary, auth.listLoginHistory);
router.delete('/accounts/:id', requireAuth, requireSecretary, auth.deleteAccount);

module.exports = router;
