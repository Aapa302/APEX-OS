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

// Robust multi-case checksum verification helper
function verifySimulationChecksum(sim) {
  const currentSequence = sim.sequence || "";
  const expectedChecksum = sim.checksum || "";
  if (!expectedChecksum) return false;

  // Clean raw nucleotide sequence
  let rawSeq = currentSequence.trim();
  if (rawSeq.startsWith(">")) {
    const lines = rawSeq.split("\n");
    rawSeq = lines.slice(1).join("").replace(/[^ACGTacgt]/g, "");
  } else {
    rawSeq = rawSeq.replace(/[^ACGTacgt]/g, "");
  }
  rawSeq = rawSeq.toUpperCase();

  // Case 1: Checksum is the SHA-256 of the raw DNA sequence itself
  const rawSeqHash = sha256(rawSeq);
  if (rawSeqHash === expectedChecksum) {
    return true;
  }

  // Case 2: Checksum is the SHA-256 of the decoded original payload
  try {
    const fastaForDecode = currentSequence.trim().startsWith(">")
      ? currentSequence
      : `>APEX_DNA_BLOCK|STRATEGY:${sim.strategy || "base4"}|HASH:${expectedChecksum}\n${rawSeq}\n`;

    const decodeResult = DNAEngineerService.decode(fastaForDecode);
    if (decodeResult && decodeResult.success && decodeResult.decoded) {
      const decodedHash = sha256(decodeResult.decoded);
      if (decodedHash === expectedChecksum) {
        return true;
      }
    }
  } catch (err) {
    // Ignore and try fallback
  }

  // Case 3: Checksum matches the original payload field
  if (sim.original) {
    const originalHash = sha256(sim.original);
    if (originalHash === expectedChecksum) {
      // Decode and check if it matches original
      try {
        const fastaForDecode = currentSequence.trim().startsWith(">")
          ? currentSequence
          : `>APEX_DNA_BLOCK|STRATEGY:${sim.strategy || "base4"}|HASH:${expectedChecksum}\n${rawSeq}\n`;
        const decodeResult = DNAEngineerService.decode(fastaForDecode);
        if (decodeResult && decodeResult.success && decodeResult.decoded === sim.original) {
          return true;
        }
      } catch (err) {}
    }
  }

  return false;
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

      // 1. Run checksum verification first to detect if block is corrupted.
      const isCorrupted = !verifySimulationChecksum(sim);

      if (!isCorrupted) {
        // Block is valid and healthy.
        details.push({
          id: sim.id,
          name: sim.name,
          status: "healthy",
          recovery_status: "Healthy"
        });
      } else {
        // Block is corrupted.
        corrupted_found++;
        let fixed = false;
        let finalSequence = currentSequence;
        let recoveryMethod = "";

        // 2. For each corrupted block, attempt automatic error correction.
        // Step A: Triplication / majority-vote restore.
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

          // 3. After correction, re-run checksum verification on the corrected block to confirm it's now valid.
          const tempSim = { ...sim, sequence: reconstructed };
          if (verifySimulationChecksum(tempSim)) {
            sim.sequence = reconstructed;
            fixed_count++;
            fixed = true;
            finalSequence = reconstructed;
            recoveryMethod = "triplication_majority_vote";
            await StorageService.save("simulations", sim);
            console.log(`[DNA Health Check] Successfully repaired simulation ${sim.id} via character majority-vote.`);
          } else {
            console.warn(`[DNA Health Check] Character majority-vote failed for simulation ${sim.id}: Reconstructed sequence did not match expected checksum.`);
          }
        }

        // Step B (Fallback): Re-encode from original backup copy / redundant data.
        if (!fixed && sim.original) {
          try {
            const regenerated = DNAEngineerService.encode(sim.original, sim.strategy || "base4");
            if (regenerated && regenerated.success && regenerated.sequence) {
              const tempSim = { ...sim, sequence: regenerated.sequence };
              if (!tempSim.checksum) {
                tempSim.checksum = regenerated.hash;
              }

              // 3. Re-run checksum verification on the corrected block.
              if (verifySimulationChecksum(tempSim)) {
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
                finalSequence = regenerated.sequence;
                recoveryMethod = "original_payload_reencoding";
                await StorageService.save("simulations", sim);
                console.log(`[DNA Health Check] Successfully self-healed simulation ${sim.id} by re-encoding original redundant backup copy.`);
              }
            }
          } catch (encodeErr) {
            console.error(`[DNA Health Check] Fallback repair failed for simulation ${sim.id}:`, encodeErr.message);
          }
        }

        // 4. Only after this full cycle, show ONE final, clear status per block.
        if (fixed) {
          details.push({
            id: sim.id,
            name: sim.name,
            status: "fixed",
            recovery_status: "Fully Recovered",
            original_corrupted: currentSequence,
            fixed_sequence: finalSequence,
            method: recoveryMethod
          });
        } else {
          let reason = "unable to fix - legacy format";
          if (expectedChecksum && triplicates && Array.isArray(triplicates) && triplicates.length >= 3) {
            reason = "unable to fix - majority-voted sequence hash mismatch";
          }

          details.push({
            id: sim.id,
            corrupted_id: sim.id,
            name: sim.name,
            status: "corrupted_unfixable",
            recovery_status: "Unrecoverable",
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
