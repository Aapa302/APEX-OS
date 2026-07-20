const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");

const router = express.Router();
const SIMULATIONS_FILE = path.join(__dirname, "../../simulations.json");
const HEALTH_LOGS_FILE = path.join(__dirname, "../../dna-health-logs.json");

// Helper to compute sha256
function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

// Helper to load simulations safely
async function readSimulations() {
  try {
    const data = await fs.readFile(SIMULATIONS_FILE, "utf8");
    try {
      return JSON.parse(data);
    } catch (parseErr) {
      const err = new Error(parseErr.message);
      err.name = "CorruptedSimulationsError";
      throw err;
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

// Helper to save simulations safely
async function writeSimulations(simulations) {
  const tempPath = SIMULATIONS_FILE + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(simulations, null, 2));
  await fs.rename(tempPath, SIMULATIONS_FILE);
}

// Helper to load health logs safely
async function readHealthLogs() {
  try {
    const data = await fs.readFile(HEALTH_LOGS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(HEALTH_LOGS_FILE, JSON.stringify([], null, 2));
      return [];
    }
    throw error;
  }
}

// Helper to save health logs safely
async function writeHealthLogs(logs) {
  const tempPath = HEALTH_LOGS_FILE + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(logs, null, 2));
  await fs.rename(tempPath, HEALTH_LOGS_FILE);
}

// POST /dna-health-check — runs health check and applies triplication/majority-vote error correction
router.post("/", async (req, res, next) => {
  try {
    const simulations = await readSimulations();
    const scanned_count = simulations.length;
    let corrupted_found = 0;
    let fixed_count = 0;
    const details = [];
    let fileModified = false;

    for (const sim of simulations) {
      const currentSequence = sim.sequence || "";
      const expectedChecksum = sim.checksum || "";
      const currentHash = sha256(currentSequence);

      if (currentHash === expectedChecksum) {
        details.push({
          id: sim.id,
          name: sim.name,
          status: "healthy"
        });
      } else {
        corrupted_found++;

        // Error-correction: triplication / majority-vote
        const triplicates = sim.triplicates;
        if (triplicates && Array.isArray(triplicates) && triplicates.length >= 3) {
          const seq1 = triplicates[0] || "";
          const seq2 = triplicates[1] || "";
          const seq3 = triplicates[2] || "";

          // Determine majority voted sequence character-by-character
          const maxLength = Math.max(seq1.length, seq2.length, seq3.length);
          let reconstructed = "";

          for (let i = 0; i < maxLength; i++) {
            const char1 = seq1[i] || "";
            const char2 = seq2[i] || "";
            const char3 = seq3[i] || "";

            const counts = {};
            counts[char1] = (counts[char1] || 0) + 1;
            counts[char2] = (counts[char2] || 0) + 1;
            counts[char3] = (counts[char3] || 0) + 1;

            let majorityChar = "";
            let maxCount = 0;
            for (const [char, count] of Object.entries(counts)) {
              if (count > maxCount) {
                maxCount = count;
                majorityChar = char;
              }
            }
            reconstructed += majorityChar;
          }

          const reconstructedHash = sha256(reconstructed);
          if (reconstructedHash === expectedChecksum) {
            sim.sequence = reconstructed;
            fixed_count++;
            fileModified = true;
            details.push({
              id: sim.id,
              name: sim.name,
              status: "fixed",
              original_corrupted: currentSequence,
              fixed_sequence: reconstructed
            });
          } else {
            details.push({
              id: sim.id,
              name: sim.name,
              status: "corrupted_unfixable",
              reason: "Majority-voted sequence hash mismatch"
            });
          }
        } else {
          details.push({
            id: sim.id,
            name: sim.name,
            status: "corrupted_unfixable",
            reason: "No valid triplicates found for majority voting"
          });
        }
      }
    }

    if (fileModified) {
      await writeSimulations(simulations);
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      scanned_count,
      corrupted_found,
      fixed_count,
      details
    };

    const logs = await readHealthLogs();
    logs.push(logEntry);
    await writeHealthLogs(logs);

    res.json(logEntry);
  } catch (error) {
    if (error.name === "CorruptedSimulationsError") {
      return res.status(422).json({
        error: "simulations.json is corrupted",
        details: error.message
      });
    }
    next(error);
  }
});

// GET /dna-health-check/logs — returns previous health check logs
router.get("/logs", async (req, res, next) => {
  try {
    const logs = await readHealthLogs();
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
