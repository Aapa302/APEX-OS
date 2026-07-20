const assert = require("assert");
const fs = require("fs").promises;
const path = require("path");

// Mock environment and load geminiService
process.env.GEMINI_API_KEY = "dummy_key";
process.env.AI_PROVIDER = "gemini";

// Start the Express server on port 8787
require("../src/server");

const { executeTool } = require("../src/services/geminiService");

const TASKS_FILE = path.join(process.cwd(), "tasks.json");
const SIMULATIONS_FILE = path.join(process.cwd(), "simulations.json");

// Small delay to ensure server started listening
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runToolTests() {
  console.log("🧪 Running Gemini native tool execution tests...");
  await sleep(1000);

  // Backup original files if they exist
  let tasksBackup = null;
  let simsBackup = null;

  try {
    tasksBackup = await fs.readFile(TASKS_FILE, "utf8");
  } catch (e) {}

  try {
    simsBackup = await fs.readFile(SIMULATIONS_FILE, "utf8");
  } catch (e) {}

  try {
    // Test 1: create_task
    console.log("  - Testing tool 'create_task'");
    const taskTitle = "Test Task via Tool Execution " + Math.random().toString(36).substring(2, 5);
    const newTask = await executeTool("create_task", {
      title: taskTitle,
      phase: "Research",
      description: "Verification description",
      priority: "high"
    });

    assert.ok(newTask.id, "Should have returned a task object with an id");
    assert.strictEqual(newTask.title, taskTitle);
    assert.strictEqual(newTask.phase, "Research");
    assert.strictEqual(newTask.priority, "high");

    // Test 2: get_tasks
    console.log("  - Testing tool 'get_tasks'");
    const tasks = await executeTool("get_tasks", {});
    assert.ok(Array.isArray(tasks), "Should return array of tasks");
    const found = tasks.find(t => t.id === newTask.id);
    assert.ok(found, "The created task must exist in the tasks list");

    // Test 3: update_task
    console.log("  - Testing tool 'update_task'");
    const updatedTask = await executeTool("update_task", {
      id: newTask.id,
      column: "inprogress",
      priority: "low"
    });
    assert.strictEqual(updatedTask.column, "inprogress");
    assert.strictEqual(updatedTask.priority, "low");

    // Test 4: trigger_simulation
    console.log("  - Testing tool 'trigger_simulation'");
    const simName = "PCR stress simulation " + Math.random().toString(36).substring(2, 5);
    const newSim = await executeTool("trigger_simulation", {
      name: simName,
      type: "PCR Amplification",
      status: "queued"
    });
    assert.ok(newSim.id, "Simulation should have an id");
    assert.strictEqual(newSim.name, simName);
    assert.strictEqual(newSim.status, "queued");

    // Test 5: get_simulations
    console.log("  - Testing tool 'get_simulations'");
    const sims = await executeTool("get_simulations", {});
    assert.ok(Array.isArray(sims));
    const foundSim = sims.find(s => s.id === newSim.id);
    assert.ok(foundSim);

    console.log("✅ Tool execution tests passed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Tool execution tests failed:", err);
    process.exit(1);
  } finally {
    // Restore files to original state so we don't mess up any persistent files
    if (tasksBackup !== null) {
      await fs.writeFile(TASKS_FILE, tasksBackup);
    } else {
      try { await fs.unlink(TASKS_FILE); } catch (e) {}
    }

    if (simsBackup !== null) {
      await fs.writeFile(SIMULATIONS_FILE, simsBackup);
    } else {
      try { await fs.unlink(SIMULATIONS_FILE); } catch (e) {}
    }
  }
}

runToolTests();
