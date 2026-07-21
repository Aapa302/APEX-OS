const express = require("express");
const StorageService = require("../services/StorageService");

const router = express.Router();

// GET /api/experiments
router.get("/", async (req, res, next) => {
  try {
    const list = await StorageService.getAll("experiments");
    res.json(list);
  } catch (error) {
    next(error);
  }
});

// POST /api/experiments
router.post("/", async (req, res, next) => {
  try {
    const { hypothesis, accuracy, results, ...rest } = req.body;

    if (!hypothesis || typeof hypothesis !== "string") {
      return res.status(400).json({
        error: "Missing or invalid required parameter: 'hypothesis'."
      });
    }

    const newId = "exp_" + Date.now().toString() + "_" + Math.random().toString(36).substring(2, 7);
    const newRecord = {
      id: newId,
      hypothesis: hypothesis.trim(),
      accuracy: (accuracy || "n/a").trim(),
      results: (results || "").trim(),
      date: new Date().toISOString(),
      ...rest
    };

    await StorageService.save("experiments", newRecord);

    res.status(201).json({
      success: true,
      id: newId,
      record: newRecord
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/experiments/:id
router.patch("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const experiment = await StorageService.getById("experiments", id);
    if (!experiment) {
      return res.status(404).json({
        error: `Experiment with id '${id}' not found.`
      });
    }

    const validUpdates = {};
    for (const key of Object.keys(updates)) {
      if (key !== "id") {
        validUpdates[key] = updates[key];
      }
    }

    const record = await StorageService.update("experiments", id, validUpdates);

    res.json({
      success: true,
      record
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/experiments/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const experiment = await StorageService.getById("experiments", id);
    if (!experiment) {
      return res.status(404).json({
        error: `Experiment with id '${id}' not found.`
      });
    }

    await StorageService.delete("experiments", id);

    res.json({
      success: true,
      message: "Experiment deleted successfully."
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
