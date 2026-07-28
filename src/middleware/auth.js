// Authentication/Authorization Middleware
// Note: Per-user authentication and database isolation have been completely and intentionally
// disabled/removed. This middleware functions purely as a pass-through, ensuring that all records
// across all collections (regardless of original userId) are visible, accessible, and editable
// by all users of the system without filtering.
async function verifyFirebaseToken(req, res, next) {
  next();
}

module.exports = { verifyFirebaseToken };
