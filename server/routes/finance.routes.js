const express = require('express');
const router = express.Router();
const finance = require('../controllers/finance.controller');
const { requireSecretary } = require('../middleware/auth');

router.get('/', requireSecretary, finance.list);
router.post('/', requireSecretary, finance.create);
router.put('/:id', requireSecretary, finance.update);
router.delete('/:id', requireSecretary, finance.remove);

module.exports = router;
