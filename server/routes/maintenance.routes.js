const express = require('express');
const router = express.Router();
const maintenance = require('../controllers/maintenance.controller');
const { requireSecretary } = require('../middleware/auth');

router.get('/', requireSecretary, maintenance.byMonth);
router.post('/', requireSecretary, maintenance.save);

module.exports = router;
