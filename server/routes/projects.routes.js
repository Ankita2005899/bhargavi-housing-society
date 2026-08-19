const express = require('express');
const router = express.Router();
const projects = require('../controllers/projects.controller');
const { requireSecretary } = require('../middleware/auth');

router.get('/', requireSecretary, projects.list);
router.post('/', requireSecretary, projects.create);
router.put('/:id', requireSecretary, projects.update);
router.delete('/:id', requireSecretary, projects.remove);

module.exports = router;
