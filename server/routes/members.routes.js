const express = require('express');
const router = express.Router();
const members = require('../controllers/members.controller');
const { requireSecretary, requireSelfOrSecretary } = require('../middleware/auth');

router.get('/', requireSecretary, members.list);
router.get('/count', members.publicCount);
router.get('/rooms', requireSecretary, members.roomsGrouped);
router.get('/:id/profile', requireSelfOrSecretary, members.profile);
router.post('/', requireSecretary, members.create);
router.put('/:id', requireSecretary, members.update);
router.delete('/:id', requireSecretary, members.remove);

module.exports = router;
