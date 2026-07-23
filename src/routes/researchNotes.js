const express = require("express");
const StorageService = require("../services/StorageService");
const { verifyFirebaseToken } = require("../middleware/auth");

const router = express.Router();

// Require auth for all research notes routes
router.use(verifyFirebaseToken);

// GET /api/research-notes - Returns all records from research_notes collection
router.get("/", async (req, res, next) => {
  try {
    const reports = await StorageService.getAll("research_notes");

    // Filter research notes: user's own notes OR legacy/unassigned documents
    const filtered = reports.map(r => {
      if (!r.userId) {
        return { ...r, userId: "legacy/unassigned" };
      }
      return r;
    }).filter(r => r.userId === req.userId || r.userId === "legacy/unassigned");

    res.json(filtered);
  } catch (error) {
    next(error);
  }
});

// POST /api/research-notes - Appends a naya record to research_notes collection
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

    // Generate unique ID
    const newId = "note_" + Date.now().toString() + "_" + Math.random().toString(36).substring(2, 7);

    const newRecord = {
      id: newId,
      title: title.trim(),
      category: category.trim(),
      content: content.trim(),
      userId: req.userId, // Save userId
      date: new Date().toISOString()
    };

    await StorageService.save("research_notes", newRecord);

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

    const report = await StorageService.getById("research_notes", id);
    if (!report) {
      return res.status(404).json({
        error: {
          type: "not_found",
          message: `Research note with id '${id}' not found.`
        }
      });
    }

    // Check ownership (allow if same user or legacy document)
    if (report.userId && report.userId !== req.userId) {
      return res.status(403).json({
        error: {
          type: "forbidden",
          message: "You do not have permission to modify or delete this document."
        }
      });
    }

    await StorageService.delete("research_notes", id);

    res.json({
      success: true,
      message: "Research note deleted successfully."
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
