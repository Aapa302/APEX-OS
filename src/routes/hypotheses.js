const express = require("express");
const fs = require("fs").promises;
const path = require("path");

const router = express.Router();
const HYPOTHESES_FILE = path.join(__dirname, "../../hypotheses.json");

// Helper to load hypotheses
async function readHypotheses() {
  try {
    const data = await fs.readFile(HYPOTHESES_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(HYPOTHESES_FILE, JSON.stringify([], null, 2), "utf8");
      return [];
    }
    throw error;
  }
}

// Helper to save hypotheses atomically
async function writeHypotheses(data) {
  const tempPath = HYPOTHESES_FILE + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, HYPOTHESES_FILE);
}

// GET /api/hypotheses
router.get("/", async (req, res, next) => {
  try {
    const list = await readHypotheses();
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

    const list = await readHypotheses();

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

    list.push(newRecord);
    await writeHypotheses(list);

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

    const list = await readHypotheses();
    const index = list.findIndex(h => h.id === id);

    if (index === -1) {
      return res.status(404).json({
        error: `Hypothesis with id '${id}' not found.`
      });
    }

    const record = list[index];

    if (status !== undefined) record.status = String(status).trim();
    if (confidence !== undefined) record.confidence = String(confidence).trim();
    if (statement !== undefined) record.statement = String(statement).trim();
    if (category !== undefined) record.category = String(category).trim();
    if (evidence !== undefined) record.evidence = String(evidence).trim();

    await writeHypotheses(list);

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

    const list = await readHypotheses();
    const index = list.findIndex(h => h.id === id);

    if (index === -1) {
      return res.status(404).json({
        error: `Hypothesis with id '${id}' not found.`
      });
    }

    list.splice(index, 1);
    await writeHypotheses(list);

    res.json({
      success: true,
      message: "Hypothesis deleted successfully."
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
