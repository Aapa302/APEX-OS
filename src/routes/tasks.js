const express = require("express");
const StorageService = require("../services/StorageService");
const { verifyFirebaseToken } = require("../middleware/auth");

const router = express.Router();

// Apply auth middleware to all tasks routes
router.use(verifyFirebaseToken);

/**
 * Shared internal helper to create a task using the standard business rules.
 */
async function createTaskInternal({ title, description, phase, column, assignee, priority }) {
  if (!title || !phase) {
    throw new Error("Title and Phase are required fields.");
  }

  const tasks = await StorageService.getAll("tasks");

  // duplicate check within all tasks
  const duplicate = tasks.some(
    t => t.title.trim().toLowerCase() === title.trim().toLowerCase() &&
         t.phase.trim().toLowerCase() === phase.trim().toLowerCase()
  );

  if (duplicate) {
    throw new Error("Duplicate task found with the same title and phase.");
  }

  const validColumns = ["todo", "inprogress", "review", "done"];
  let taskColumn = (column || "todo").toLowerCase().replace(/\s+/g, "");
  if (taskColumn === "completed") {
    taskColumn = "done";
  }
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
    createdAt: new Date().toISOString()
  };

  await StorageService.save("tasks", newTask);
  return newTask;
}

// GET /tasks — returns all tasks
// Note: All tasks are fetched and returned. Per-user or userId-based filtering is completely
// and intentionally disabled/removed here as the app doesn't use per-user authentication.
// This ensures that all tasks (including legacy tasks with old Firebase UIDs) are fully visible.
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
    try {
      const newTask = await createTaskInternal({ title, description, phase, column, assignee, priority });
      res.status(201).json(newTask);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  } catch (error) {
    next(error);
  }
});

const HANDOFF_CHAINS = [
  {
    fromAssignee: "researcher",
    toAssignee: "engineer",
    triggerColumns: ["done", "completed"],
    titlePrefix: "[HANDOFF] Implement based on research: ",
    descriptionPrefix: "Reference to completed research task ID: ",
    defaultPhase: "Research"
  },
  {
    fromAssignee: "engineer",
    toAssignee: "reviewer",
    triggerColumns: ["done", "completed", "review"],
    titlePrefix: "[HANDOFF] Review and QA: ",
    descriptionPrefix: "Reference to completed engineering task ID: ",
    defaultPhase: "Engineering"
  },
  {
    fromAssignee: "reviewer",
    toAssignee: null,
    chainComplete: true,
    triggerColumns: ["done", "completed"],
    titleMatchPrefix: "[HANDOFF] Review and QA:"
  }
];

/**
 * PATCH /tasks/:id — updates column/status of a task
 *
 * Design Rule: The core task status update must always succeed and return a response
 * as long as the task exists and the requested column is valid, REGARDLESS of whether
 * any handoff / notification side-effects succeed or fail.
 *
 * To ensure this resilience, each handoff/notification logic block (Phase 2.1, 2.2,
 * and 2.3) must be wrapped in its own individual try-catch block.
 */
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
      if (normalized === "completed") {
        normalized = "done";
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

    // Config-driven Handoff Engine (Phase 2.1, 2.2, and 2.3)
    for (const rule of HANDOFF_CHAINS) {
      try {
        const finalAssignee = (updates.assignee !== undefined ? updates.assignee : task.assignee) || "";
        const isTriggerColumn = rule.triggerColumns.includes(updates.column);

        if (isTriggerColumn && finalAssignee.toLowerCase().trim() === rule.fromAssignee) {
          if (rule.chainComplete) {
            const taskTitle = task.title || "";
            if (taskTitle.startsWith(rule.titleMatchPrefix)) {
              const originalFeatureName = taskTitle.replace(new RegExp(`^${rule.titleMatchPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), "").trim();
              updates.chainComplete = true;
              updates.chainCompleteMessage = `✅ Collaboration Complete: ${originalFeatureName} — Researched, built, and reviewed. Ready to ship.`;
              console.log(`[Handoff Rules Engine] Handoff chain complete for: ${originalFeatureName}`);
            }
          } else if (!task.handedOff && !updates.handedOff) {
            updates.handedOff = true;
            const originalTitle = updates.title !== undefined ? updates.title : (task.title || "");
            const originalDescription = updates.description !== undefined ? updates.description : (task.description || "");
            const originalPhase = updates.phase !== undefined ? updates.phase : (task.phase || rule.defaultPhase);

            await createTaskInternal({
              title: `${rule.titlePrefix}${originalTitle}`,
              description: `${rule.descriptionPrefix}${task.id}\n\nOriginal Description:\n${originalDescription}`,
              phase: originalPhase,
              column: "todo",
              assignee: rule.toAssignee,
              priority: (updates.priority !== undefined ? updates.priority : task.priority) || "medium"
            });
            console.log(`[Handoff Rules Engine] Successfully handed off task ${task.id} to ${rule.toAssignee}.`);
          }
        }
      } catch (err) {
        console.error(`[Handoff Rules Engine] Failed handoff check for ${rule.fromAssignee}->${rule.toAssignee || "complete"}: ${err.message}`);
      }
    }

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
