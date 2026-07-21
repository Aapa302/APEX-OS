const express = require("express");
const fs = require("fs").promises;
const path = require("path");

const router = express.Router();
const RESEARCH_FILE = path.join(__dirname, "../../research-reports.json");

// Helper to load research reports
async function readResearchReports() {
  try {
    const data = await fs.readFile(RESEARCH_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(RESEARCH_FILE, JSON.stringify([], null, 2), "utf8");
      return [];
    }
    throw error;
  }
}

// Helper to save research reports atomically
async function writeResearchReports(reports) {
  const tempPath = RESEARCH_FILE + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(reports, null, 2), "utf8");
  await fs.rename(tempPath, RESEARCH_FILE);
}

// GET /api/research-notes - Returns all records from research-reports.json
router.get("/", async (req, res, next) => {
  try {
    const reports = await readResearchReports();
    res.json(reports);
  } catch (error) {
    next(error);
  }
});

// POST /api/research-notes - Appends a new record to research-reports.json
router.post("/", async (req, res, next) => {
  try {
    const { title, category, content } = req.body;

    if (!title || typeof title !== "string" || !category || typeof category !== "string" || !content || typeof content !== "string") {
      return res.status(400).json({
        error: {
          type: "invalid_request",
          message: "Missing or invalid required parameters: 'title', 'category', and 'content' must be non-empty strings."
        }
      });
    }

    const reports = await readResearchReports();

    // Generate unique ID
    const newId = "note_" + Date.now().toString() + "_" + Math.random().toString(36).substring(2, 7);

    const newRecord = {
      id: newId,
      title: title.trim(),
      category: category.trim(),
      content: content.trim(),
      date: new Date().toISOString()
    };

    reports.push(newRecord);
    await writeResearchReports(reports);

    res.status(201).json({
      success: true,
      id: newId
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/research-notes/:id - Removes a record with the matching ID
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: {
          type: "invalid_request",
          message: "Missing 'id' parameter."
        }
      });
    }

    const reports = await readResearchReports();
    const index = reports.findIndex(r => r.id === id);

    if (index === -1) {
      return res.status(404).json({
        error: {
          type: "not_found",
          message: `Research note with id '${id}' not found.`
        }
      });
    }

    reports.splice(index, 1);
    await writeResearchReports(reports);

    res.json({
      success: true,
      message: "Research note deleted successfully."
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
