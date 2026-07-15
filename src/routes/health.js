// ════════════════════════════════════════════════════════════
// Route: GET /health
// Quick liveness probe — Docker, Railway, Render, etc. use this.
// ════════════════════════════════════════════════════════════

const express = require("express");
const config = require("../config/env");

const router = express.Router();
const startTime = Date.now();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    apiKeySet: !!config.geminiApiKey,
    ncbiApiKeySet: !!config.ncbiApiKey,
    corsOrigin: config.corsOrigin,
    provider: config.aiProvider,
    model: config.geminiModel,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
