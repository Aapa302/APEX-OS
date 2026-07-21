const express = require("express");
const fs = require("fs").promises;
const path = require("path");

const router = express.Router();
const SIMULATIONS_FILE = path.join(__dirname, "../../simulations.json");

router.post("/", async (req, res, next) => {
  try {
    const { name, sequence, checksum } = req.body;

    if (!name || typeof name !== "string" || !sequence || typeof sequence !== "string" || !checksum || typeof checksum !== "string") {
      return res.status(400).json({
        error: {
          type: "invalid_request",
          message: "Missing or invalid required parameters: 'name', 'sequence', and 'checksum' must be non-empty strings."
        }
      });
    }

    // Read existing simulations
    let simulations = [];
    try {
      const data = await fs.readFile(SIMULATIONS_FILE, "utf8");
      simulations = JSON.parse(data);
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }

    // Determine the next numeric ID
    let maxNum = 0;
    for (const sim of simulations) {
      if (sim.id && sim.id.startsWith("sim_")) {
        const num = parseInt(sim.id.replace("sim_", ""), 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
    const newId = `sim_${maxNum + 1}`;

    // Create the new simulation record
    const newRecord = {
      id: newId,
      name,
      sequence,
      checksum,
      triplicates: [sequence, sequence, sequence], // Standard triplicates
      original: "", // Can be filled or left empty
      strategy: "base4" // Default strategy
    };

    // Append the new record
    simulations.push(newRecord);

    // Save back to simulations.json
    await fs.writeFile(SIMULATIONS_FILE, JSON.stringify(simulations, null, 2), "utf8");

    res.json({
      success: true,
      id: newId
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
