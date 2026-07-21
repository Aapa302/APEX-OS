const express = require("express");
const StorageService = require("../services/StorageService");

const router = express.Router();

// GET /api/hypotheses
router.get("/", async (req, res, next) => {
  try {
    const list = await StorageService.getAll("hypotheses");
    res.json(list);
  } catch (error) {
    next(error);
  }
});

// POST /api/hypotheses
router.post("/", async (req, res, next) => {
  try {
    const { statement, status, confidence, category, evidence } = req.body;

    if (!statement || typeof statement !== "string") {
      return res.status(400).json({
        error: "Missing or invalid required parameter: 'statement'."
      });
    }

    const newId = "hyp_" + Date.now().toString() + "_" + Math.random().toString(36).substring(2, 7);
    const newRecord = {
      id: newId,
      statement: statement.trim(),
      status: (status || "Pending").trim(),
      confidence: (confidence || "Medium").trim(),
      category: (category || "General").trim(),
      evidence: (evidence || "").trim(),
      date: new Date().toISOString()
    };

    await StorageService.save("hypotheses", newRecord);

    res.status(201).json({
      success: true,
      id: newId,
      record: newRecord
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/hypotheses/:id
router.patch("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, confidence, statement, category, evidence } = req.body;

    const hypothesis = await StorageService.getById("hypotheses", id);
    if (!hypothesis) {
      return res.status(404).json({
        error: `Hypothesis with id '${id}' not found.`
      });
    }

    const updates = {};
    if (status !== undefined) updates.status = String(status).trim();
    if (confidence !== undefined) updates.confidence = String(confidence).trim();
    if (statement !== undefined) updates.statement = String(statement).trim();
    if (category !== undefined) updates.category = String(category).trim();
    if (evidence !== undefined) updates.evidence = String(evidence).trim();

    const record = await StorageService.update("hypotheses", id, updates);

    res.json({
      success: true,
      record
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/hypotheses/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const hypothesis = await StorageService.getById("hypotheses", id);
    if (!hypothesis) {
      return res.status(404).json({
        error: `Hypothesis with id '${id}' not found.`
      });
    }

    await StorageService.delete("hypotheses", id);

    res.json({
      success: true,
      message: "Hypothesis deleted successfully."
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
