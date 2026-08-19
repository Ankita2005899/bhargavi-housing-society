const express = require('express');
const router = express.Router();
const staff = require('../controllers/staff.controller');
const { requireSecretary } = require('../middleware/auth');

router.get('/', requireSecretary, staff.list);
router.post('/', requireSecretary, staff.create);
router.put('/:id', requireSecretary, staff.update);
router.delete('/:id', requireSecretary, staff.remove);

module.exports = router;
