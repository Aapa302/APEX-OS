const express = require("express");
const fs = require("fs").promises;
const path = require("path");

const router = express.Router();
const SIMULATIONS_FILE = path.join(__dirname, "../../simulations.json");

// Helper to load simulations
async function readSimulations() {
  try {
    const data = await fs.readFile(SIMULATIONS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      // Seed default simulations for standard initial view
      const defaults = [
        {
          id: "sim-1",
          name: "Thermal PCR Cycling Simulation",
          type: "PCR Amplification",
          status: "completed",
          progress: 100,
          estimatedTime: "Completed",
          createdAt: new Date(Date.now() - 3600000).toISOString()
        },
        {
          id: "sim-2",
          name: "Illumina NovaSeq Error Sweep",
          type: "Sequencing Profiler",
          status: "running",
          progress: 45,
          estimatedTime: "45s",
          createdAt: new Date().toISOString()
        },
        {
          id: "sim-3",
          name: "Oxford Nanopore Indels Insertion",
          type: "Mutational Stress-test",
          status: "queued",
          progress: 0,
          estimatedTime: "2m 10s",
          createdAt: new Date().toISOString()
        }
      ];
      await fs.writeFile(SIMULATIONS_FILE, JSON.stringify(defaults, null, 2));
      return defaults;
    }
    throw error;
  }
}

// Helper to save simulations
async function writeSimulations(sims) {
  const tempPath = SIMULATIONS_FILE + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(sims, null, 2));
  await fs.rename(tempPath, SIMULATIONS_FILE);
}

// GET /simulations — saare simulations return kare
router.get("/", async (req, res, next) => {
  try {
    const sims = await readSimulations();
    res.json(sims);
  } catch (error) {
    next(error);
  }
});

// POST /simulations — naya simulation create kare
router.post("/", async (req, res, next) => {
  try {
    const { name, type, status, progress, estimatedTime } = req.body;
    const sims = await readSimulations();

    const newSim = {
      id: "sim_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      name: name || "Custom Monte Carlo Run",
      type: type || "Stress-test Simulation",
      status: status || "queued",
      progress: progress !== undefined ? progress : 0,
      estimatedTime: estimatedTime || "1m 30s",
      createdAt: new Date().toISOString()
    };

    sims.push(newSim);
    await writeSimulations(sims);
    res.status(201).json(newSim);
  } catch (error) {
    next(error);
  }
});

// PATCH /simulations/:id — status/progress update kare
router.patch("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, progress, estimatedTime, name, type } = req.body;

    const sims = await readSimulations();
    const idx = sims.findIndex(s => s.id === id);

    if (idx === -1) {
      return res.status(404).json({ error: "Simulation not found" });
    }

    const sim = sims[idx];
    if (status !== undefined) sim.status = status;
    if (progress !== undefined) sim.progress = progress;
    if (estimatedTime !== undefined) sim.estimatedTime = estimatedTime;
    if (name !== undefined) sim.name = name;
    if (type !== undefined) sim.type = type;

    await writeSimulations(sims);
    res.json(sim);
  } catch (error) {
    next(error);
  }
});

// DELETE /simulations/:id — cancel/remove kare
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const sims = await readSimulations();
    const idx = sims.findIndex(s => s.id === id);

    if (idx === -1) {
      return res.status(404).json({ error: "Simulation not found" });
    }

    const deleted = sims.splice(idx, 1)[0];
    await writeSimulations(sims);
    res.json({ message: "Simulation deleted successfully", simulation: deleted });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
