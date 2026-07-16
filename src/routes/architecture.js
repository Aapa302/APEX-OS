// ════════════════════════════════════════════════════════════
// Router: /api/architecture
// Express endpoints for DNA Storage Architecture evaluation.
// ════════════════════════════════════════════════════════════

const express = require("express");
const StorageArchitectService = require("../services/StorageArchitectService");
const { logger } = require("../middleware/logger");

const router = express.Router();

router.post("/evaluate", (req, res, next) => {
  const { algorithms, dna, experiments } = req.body;

  try {
    logger.info("Storage Architecture evaluation requested.");
    const result = StorageArchitectService.evaluateArchitecture(algorithms, dna, experiments);
    res.json(result);
  } catch (err) {
    logger.error("Architecture evaluation error", err.message);
    res.status(500).json({
      error: {
        type: "evaluation_error",
        message: err.message
      }
    });
  }
});

module.exports = router;
