// The only two account roles in the system.
//
// SECRETARY — full access: every member's details, finance, projects,
//             maintenance, hospitals, ambulances, staff/vendors.
// RESIDENT  — self-service access only: can view and edit their own
//             member profile, but not anyone else's.
module.exports = {
  SECRETARY: 'secretary',
  RESIDENT: 'resident'
};
