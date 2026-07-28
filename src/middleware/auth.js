async function verifyFirebaseToken(req, res, next) {
  req.userId = "mock-test-user";
  next();
}

module.exports = { verifyFirebaseToken };
