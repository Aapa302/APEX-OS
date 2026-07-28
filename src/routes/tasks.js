const express = require("express");
const StorageService = require("../services/StorageService");
const { verifyFirebaseToken } = require("../middleware/auth");

const router = express.Router();

// Apply auth middleware to all tasks routes
router.use(verifyFirebaseToken);

// GET /tasks — returns all tasks
router.get("/", async (req, res, next) => {
  try {
    const tasks = await StorageService.getAll("tasks");
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

// POST /tasks — creates a new task
router.post("/", async (req, res, next) => {
  try {
    const { title, description, phase, column, assignee, priority } = req.body;

    if (!title || !phase) {
      return res.status(400).json({ error: "Title and Phase are required fields." });
    }

    const tasks = await StorageService.getAll("tasks");

    // duplicate check within all tasks
    const duplicate = tasks.some(
      t => t.title.trim().toLowerCase() === title.trim().toLowerCase() &&
           t.phase.trim().toLowerCase() === phase.trim().toLowerCase()
    );

    if (duplicate) {
      return res.status(400).json({ error: "Duplicate task found with the same title and phase." });
    }

    const validColumns = ["todo", "inprogress", "review", "done"];
    let taskColumn = (column || "todo").toLowerCase().replace(/\s+/g, "");
    if (!validColumns.includes(taskColumn)) {
      taskColumn = "todo";
    }

    const newTask = {
      id: Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9),
      title: title.trim(),
      description: (description || "").trim(),
      phase: phase.trim(),
      column: taskColumn,
      assignee: (assignee || "Unassigned").trim(),
      priority: (priority || "medium").toLowerCase().trim(),
      userId: req.userId, // Save userId
      createdAt: new Date().toISOString()
    };

    await StorageService.save("tasks", newTask);

    res.status(201).json(newTask);
  } catch (error) {
    next(error);
  }
});

// PATCH /tasks/:id — updates column/status of a task
router.patch("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { column, status, title, description, phase, assignee, priority } = req.body;

    const task = await StorageService.getById("tasks", id);
    if (!task) {
      return res.status(404).json({ error: "Task not found." });
    }

    // No ownership check needed as multi-user auth is removed

    const updates = {};

    const targetColumn = column || status;
    if (targetColumn) {
      const validColumns = ["todo", "inprogress", "review", "done"];
      let normalized = targetColumn.toLowerCase().replace(/\s+/g, "");
      if (normalized === "in-progress") {
        normalized = "inprogress";
      }
      if (validColumns.includes(normalized)) {
        updates.column = normalized;
      } else {
        return res.status(400).json({ error: `Invalid column/status. Must be one of: ${validColumns.join(", ")}` });
      }
    }

    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description.trim();
    if (phase !== undefined) updates.phase = phase.trim();
    if (assignee !== undefined) updates.assignee = assignee.trim();
    if (priority !== undefined) updates.priority = priority.toLowerCase().trim();

    const updatedTask = await StorageService.update("tasks", id, updates);

    res.json(updatedTask);
  } catch (error) {
    next(error);
  }
});

// DELETE /tasks/:id — deletes a task
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const task = await StorageService.getById("tasks", id);
    if (!task) {
      return res.status(404).json({ error: "Task not found." });
    }

    // No ownership check needed as multi-user auth is removed

    await StorageService.delete("tasks", id);

    res.json({ message: "Task deleted successfully.", task });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
