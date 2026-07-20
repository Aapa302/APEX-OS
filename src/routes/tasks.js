const express = require("express");
const fs = require("fs").promises;
const path = require("path");

const router = express.Router();
const TASKS_FILE = path.join(__dirname, "../../tasks.json");

// Helper to load tasks
async function readTasks() {
  try {
    const data = await fs.readFile(TASKS_FILE, "utf8");
    const tasks = JSON.parse(data);
    return tasks.map(t => {
      const colVal = t.column || t.status || "todo";
      t.column = colVal;
      t.status = colVal;
      return t;
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(TASKS_FILE, JSON.stringify([], null, 2));
      return [];
    }
    throw error;
  }
}

// Helper to save tasks
async function writeTasks(tasks) {
  const tempPath = TASKS_FILE + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(tasks, null, 2));
  await fs.rename(tempPath, TASKS_FILE);
}

// GET /tasks — returns all tasks
router.get("/", async (req, res, next) => {
  try {
    const tasks = await readTasks();
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

    const tasks = await readTasks();

    // duplicate check: same title + phase already exist na ho
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
      status: taskColumn,
      assignee: (assignee || "Unassigned").trim(),
      priority: (priority || "medium").toLowerCase().trim(),
      createdAt: new Date().toISOString()
    };

    tasks.push(newTask);
    await writeTasks(tasks);

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

    const tasks = await readTasks();
    const taskIndex = tasks.findIndex(t => t.id === id);

    if (taskIndex === -1) {
      return res.status(404).json({ error: "Task not found." });
    }

    const task = tasks[taskIndex];

    const targetColumn = column || status;
    if (targetColumn) {
      const validColumns = ["todo", "inprogress", "review", "done"];
      let normalized = targetColumn.toLowerCase().replace(/\s+/g, "");
      if (normalized === "in-progress") {
        normalized = "inprogress";
      }
      if (validColumns.includes(normalized)) {
        task.column = normalized;
        task.status = normalized;
      } else {
        return res.status(400).json({ error: `Invalid column/status. Must be one of: ${validColumns.join(", ")}` });
      }
    }

    if (title !== undefined) task.title = title.trim();
    if (description !== undefined) task.description = description.trim();
    if (phase !== undefined) task.phase = phase.trim();
    if (assignee !== undefined) task.assignee = assignee.trim();
    if (priority !== undefined) task.priority = priority.toLowerCase().trim();

    await writeTasks(tasks);

    res.json(task);
  } catch (error) {
    next(error);
  }
});

// DELETE /tasks/:id — deletes a task
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const tasks = await readTasks();
    const taskIndex = tasks.findIndex(t => t.id === id);

    if (taskIndex === -1) {
      return res.status(404).json({ error: "Task not found." });
    }

    const deletedTask = tasks.splice(taskIndex, 1)[0];
    await writeTasks(tasks);

    res.json({ message: "Task deleted successfully.", task: deletedTask });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
