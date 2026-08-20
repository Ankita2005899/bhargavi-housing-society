const express = require('express');
const router = express.Router();
const hospitals = require('../controllers/hospitals.controller');
const { requireSecretary } = require('../middleware/auth');

router.get('/', requireSecretary, hospitals.list);
router.post('/', requireSecretary, hospitals.create);
router.put('/:id', requireSecretary, hospitals.update);
router.delete('/:id', requireSecretary, hospitals.remove);

module.exports = router;
