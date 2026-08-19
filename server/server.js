// Entry point — `npm start` runs this file (see package.json). All the
// real setup lives in app.js; this file just boots it.
const { start } = require('./app');

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
