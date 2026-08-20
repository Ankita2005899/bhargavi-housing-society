function dbError(res, err) {
  console.error(err);
  res.status(500).json({ error: 'Database error', detail: err.message });
}

// Express error-handling middleware (4 args) — catches anything thrown
// or passed to next(err) that a route didn't handle itself.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error' });
}

module.exports = { dbError, errorHandler };
