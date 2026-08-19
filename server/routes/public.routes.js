// Anonymous-friendly endpoints for the homepage "View Details" popup.
// Only ever returns non-sensitive fields — see the *.model.js files for
// exactly which columns each of these selects.
const express = require('express');
const router = express.Router();
const members = require('../controllers/members.controller');
const hospitals = require('../controllers/hospitals.controller');
const ambulances = require('../controllers/ambulances.controller');

router.get('/members', members.publicSafeList);
router.get('/hospitals', hospitals.publicList);
router.get('/ambulances', ambulances.publicList);

module.exports = router;
