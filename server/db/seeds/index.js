const seedDemoMembersIfEmpty = require('./members.seed');
const seedDemoFinanceIfEmpty = require('./finance.seed');
const seedDemoProjectsIfEmpty = require('./projects.seed');
const seedDemoHospitalsIfEmpty = require('./hospitals.seed');
const seedDemoAmbulancesIfEmpty = require('./ambulances.seed');
const seedDemoStaffIfEmpty = require('./staff.seed');
const seedSecretaryAccountIfMissing = require('./secretaryAccount.seed');

async function runSeeds() {
  await seedDemoMembersIfEmpty();
  await seedDemoFinanceIfEmpty();
  await seedDemoProjectsIfEmpty();
  await seedDemoHospitalsIfEmpty();
  await seedDemoAmbulancesIfEmpty();
  await seedDemoStaffIfEmpty();
  await seedSecretaryAccountIfMissing();
}

module.exports = runSeeds;
