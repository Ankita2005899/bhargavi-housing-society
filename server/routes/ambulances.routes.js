const express = require('express');
const router = express.Router();
const ambulances = require('../controllers/ambulances.controller');
const { requireSecretary } = require('../middleware/auth');

router.get('/', requireSecretary, ambulances.list);
router.post('/', requireSecretary, ambulances.create);
router.put('/:id', requireSecretary, ambulances.update);
router.delete('/:id', requireSecretary, ambulances.remove);

module.exports = router;
