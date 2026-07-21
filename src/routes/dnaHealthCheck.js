const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const StorageService = require("../services/StorageService");
const DNAEngineerService = require("../services/DNAEngineerService");

const router = express.Router();
const HEALTH_LOGS_FILE = path.join(__dirname, "../../dna-health-logs.json");

// Helper to compute sha256
function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
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
    let simulations;
    try {
      simulations = await StorageService.getAll("simulations");
    } catch (parseErr) {
      return res.status(422).json({
        error: "simulations.json is corrupted",
        details: parseErr.message
      });
    }

    const scanned_count = simulations.length;
    let corrupted_found = 0;
    let fixed_count = 0;
    const details = [];

    for (const sim of simulations) {
      const currentSequence = sim.sequence || "";
      const expectedChecksum = sim.checksum || "";
      const currentHash = sha256(currentSequence);

      if (expectedChecksum && currentHash === expectedChecksum) {
        details.push({
          id: sim.id,
          name: sim.name,
          status: "healthy"
        });
      } else {
        corrupted_found++;
        let fixed = false;

        // 1. Error-correction step A: Triplication / majority-vote (Index-by-index recovery)
        const triplicates = sim.triplicates;
        if (expectedChecksum && triplicates && Array.isArray(triplicates) && triplicates.length >= 3) {
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
            fixed = true;
            await StorageService.save("simulations", sim);
            details.push({
              id: sim.id,
              name: sim.name,
              status: "fixed",
              original_corrupted: currentSequence,
              fixed_sequence: reconstructed,
              method: "triplication_majority_vote"
            });
            console.log(`[DNA Health Check] Successfully repaired simulation ${sim.id} via character majority-vote.`);
          } else {
            console.warn(`[DNA Health Check] Character majority-vote failed for simulation ${sim.id}: Reconstructed sequence did not match expected checksum.`);
          }
        }

        // 2. Error-correction step B (Fallback): Re-encode from original backup copy / redundant data
        if (!fixed && sim.original) {
          try {
            const regenerated = DNAEngineerService.encode(sim.original, sim.strategy || "base4");
            if (regenerated && regenerated.success && regenerated.sequence) {
              const targetChecksum = expectedChecksum || regenerated.hash;
              if (sha256(regenerated.sequence) === targetChecksum) {
                sim.sequence = regenerated.sequence;
                if (!sim.checksum) {
                  sim.checksum = regenerated.hash;
                }
                // Automatically upgrade/heal formatting to include matching triplicates
                sim.triplicates = [
                  regenerated.sequence,
                  regenerated.sequence,
                  regenerated.sequence
                ];
                fixed_count++;
                fixed = true;
                await StorageService.save("simulations", sim);
                details.push({
                  id: sim.id,
                  name: sim.name,
                  status: "fixed",
                  original_corrupted: currentSequence,
                  fixed_sequence: regenerated.sequence,
                  method: "original_payload_reencoding"
                });
                console.log(`[DNA Health Check] Successfully self-healed simulation ${sim.id} by re-encoding original redundant backup copy.`);
              }
            }
          } catch (encodeErr) {
            console.error(`[DNA Health Check] Fallback repair failed for simulation ${sim.id}:`, encodeErr.message);
          }
        }

        // 3. If both recovery steps failed to repair the corruption
        if (!fixed) {
          let reason = "unable to fix - legacy format";
          if (expectedChecksum && triplicates && Array.isArray(triplicates) && triplicates.length >= 3) {
            reason = "unable to fix - majority-voted sequence hash mismatch";
          }

          details.push({
            id: sim.id,
            corrupted_id: sim.id,
            name: sim.name,
            status: "corrupted_unfixable",
            reason: reason
          });
          console.error(`[DNA Health Check] Simulation ${sim.id} is corrupted and unfixable (${reason}).`);
        }
      }
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
