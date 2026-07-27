// ════════════════════════════════════════════════════════════
// Router: /api/dna
// Express endpoints for the APEX OS DNA Storage Engine.
// ════════════════════════════════════════════════════════════

const express = require("express");
const DNAEngineerService = require("../services/DNAEngineerService");
const { logger } = require("../middleware/logger");
const { verifyFirebaseToken } = require("../middleware/auth");

const router = express.Router();

// Require auth for all DNA lab routes
router.use(verifyFirebaseToken);

// ── POST /api/dna/encode ────────────────────────────────────
router.post("/encode", (req, res, next) => {
  const { data, strategy } = req.body;

  if (data === undefined || data === null) {
    return res.status(400).json({
      error: {
        type: "invalid_request",
        message: "Missing required parameter: 'data' is mandatory."
      }
    });
  }

  try {
    const strat = strategy || "base4";
    logger.info(`DNA Encoding initiated. Strategy: ${strat}, size: ${typeof data === "string" ? data.length : "object"} chars.`);
    const result = DNAEngineerService.encode(data, strat);
    res.json(result);
  } catch (err) {
    logger.error("DNA Encoding error", err.message);
    res.status(500).json({
      error: {
        type: "encoding_error",
        message: err.message
      }
    });
  }
});

// ── POST /api/dna/decode ────────────────────────────────────
router.post("/decode", (req, res, next) => {
  const { sequence, strategy } = req.body;

  if (!sequence) {
    return res.status(400).json({
      error: {
        type: "invalid_request",
        message: "Missing required parameter: 'sequence' is mandatory."
      }
    });
  }

  try {
    logger.info(`DNA Decoding initiated.`);
    const result = DNAEngineerService.decode(sequence, strategy);
    res.json(result);
  } catch (err) {
    logger.error("DNA Decoding error", err.message);
    res.status(500).json({
      error: {
        type: "decoding_error",
        message: err.message
      }
    });
  }
});

// ── POST /api/dna/validate ──────────────────────────────────
router.post("/validate", (req, res, next) => {
  const { sequence } = req.body;

  if (!sequence) {
    return res.status(400).json({
      error: {
        type: "invalid_request",
        message: "Missing required parameter: 'sequence' is mandatory."
      }
    });
  }

  try {
    logger.info(`DNA Validation initiated.`);
    const result = DNAEngineerService.validate(sequence);
    res.json(result);
  } catch (err) {
    logger.error("DNA Validation error", err.message);
    res.status(500).json({
      error: {
        type: "validation_error",
        message: err.message
      }
    });
  }
});

// ── POST /api/dna/compare ───────────────────────────────────
router.post("/compare", (req, res, next) => {
  const { data } = req.body;

  if (data === undefined || data === null) {
    return res.status(400).json({
      error: {
        type: "invalid_request",
        message: "Missing required parameter: 'data' is mandatory for strategy comparison."
      }
    });
  }

  try {
    logger.info(`DNA Strategy Comparison initiated.`);
    const result = DNAEngineerService.compare(data);
    res.json(result);
  } catch (err) {
    logger.error("DNA Comparison error", err.message);
    res.status(500).json({
      error: {
        type: "comparison_error",
        message: err.message
      }
    });
  }
});

module.exports = router;
