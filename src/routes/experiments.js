const express = require("express");
const fs = require("fs").promises;
const path = require("path");

const router = express.Router();
const EXPERIMENTS_FILE = path.join(__dirname, "../../experiments.json");

// Helper to load experiments
async function readExperiments() {
  try {
    const data = await fs.readFile(EXPERIMENTS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(EXPERIMENTS_FILE, JSON.stringify([], null, 2), "utf8");
      return [];
    }
    throw error;
  }
}

// Helper to save experiments atomically
async function writeExperiments(data) {
  const tempPath = EXPERIMENTS_FILE + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, EXPERIMENTS_FILE);
}

// GET /api/experiments
router.get("/", async (req, res, next) => {
  try {
    const list = await readExperiments();
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

    const list = await readExperiments();

    const newId = "exp_" + Date.now().toString() + "_" + Math.random().toString(36).substring(2, 7);
    const newRecord = {
      id: newId,
      hypothesis: hypothesis.trim(),
      accuracy: (accuracy || "n/a").trim(),
      results: (results || "").trim(),
      date: new Date().toISOString(),
      ...rest
    };

    list.push(newRecord);
    await writeExperiments(list);

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

    const list = await readExperiments();
    const index = list.findIndex(e => e.id === id);

    if (index === -1) {
      return res.status(404).json({
        error: `Experiment with id '${id}' not found.`
      });
    }

    const record = list[index];

    // Apply updates
    for (const key of Object.keys(updates)) {
      if (key !== "id") {
        record[key] = updates[key];
      }
    }

    await writeExperiments(list);

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

    const list = await readExperiments();
    const index = list.findIndex(e => e.id === id);

    if (index === -1) {
      return res.status(404).json({
        error: `Experiment with id '${id}' not found.`
      });
    }

    list.splice(index, 1);
    await writeExperiments(list);

    res.json({
      success: true,
      message: "Experiment deleted successfully."
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
