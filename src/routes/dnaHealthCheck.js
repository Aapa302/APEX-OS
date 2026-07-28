const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const StorageService = require("../services/StorageService");
const DNAEngineerService = require("../services/DNAEngineerService");
const { verifyFirebaseToken } = require("../middleware/auth");

const router = express.Router();
const HEALTH_LOGS_FILE = path.join(__dirname, "../../dna-health-logs.json");

// Require auth
router.use(verifyFirebaseToken);

// Helper to compute sha256
function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

// Helper to compute crc32
function crc32(str) {
  const bytes = Buffer.from(str, "utf8");
  let crc = ~0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return ((~crc) >>> 0).toString();
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
  const currentSequence = sim.sequence || sim.seq || sim.dna || "";
  const expectedChecksum = sim.checksum || sim.hash || sim.expectedHash || "";
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

  // Case 1: Checksum is the SHA-256 or CRC32 of the raw DNA sequence itself
  const rawSeqHash = sha256(rawSeq);
  const rawSeqCrc = crc32(rawSeq);
  console.log(`[Case 1 Checksum Log] Calculated SHA256: "${rawSeqHash}" (type: ${typeof rawSeqHash}), Calculated CRC32: "${rawSeqCrc}" (type: ${typeof rawSeqCrc}), Expected: "${expectedChecksum}" (type: ${typeof expectedChecksum})`);
  if (String(rawSeqHash) === String(expectedChecksum) || String(rawSeqCrc) === String(expectedChecksum)) {
    return true;
  }

  // Case 2: Checksum is the SHA-256 or CRC32 of the decoded original payload
  try {
    const fastaForDecode = currentSequence.trim().startsWith(">")
      ? currentSequence
      : `>APEX_DNA_BLOCK|STRATEGY:${sim.strategy || "base4"}|HASH:${expectedChecksum}\n${rawSeq}\n`;

    const decodeResult = DNAEngineerService.decode(fastaForDecode);
    if (decodeResult && decodeResult.success && decodeResult.decoded) {
      const decodedHash = sha256(decodeResult.decoded);
      const decodedCrc = crc32(decodeResult.decoded);
      console.log(`[Case 2 Checksum Log] Decoded text: "${decodeResult.decoded}", Calculated SHA256: "${decodedHash}" (type: ${typeof decodedHash}), Calculated CRC32: "${decodedCrc}" (type: ${typeof decodedCrc}), Expected: "${expectedChecksum}" (type: ${typeof expectedChecksum})`);
      if (String(decodedHash) === String(expectedChecksum) || String(decodedCrc) === String(expectedChecksum)) {
        return true;
      }
    }
  } catch (err) {
    // Ignore and try fallback
  }

  // Case 3: Checksum matches the original payload field (using SHA-256 or CRC32)
  const originalPayload = sim.original || sim.payload || "";
  if (originalPayload) {
    const originalHash = sha256(originalPayload);
    const originalCrc = crc32(originalPayload);
    console.log(`[Case 3 Checksum Log] Original payload: "${originalPayload}", Calculated SHA256: "${originalHash}" (type: ${typeof originalHash}), Calculated CRC32: "${originalCrc}" (type: ${typeof originalCrc}), Expected: "${expectedChecksum}" (type: ${typeof expectedChecksum})`);
    if (String(originalHash) === String(expectedChecksum) || String(originalCrc) === String(expectedChecksum)) {
      // Decode and check if it matches original
      try {
        const fastaForDecode = currentSequence.trim().startsWith(">")
          ? currentSequence
          : `>APEX_DNA_BLOCK|STRATEGY:${sim.strategy || "base4"}|HASH:${expectedChecksum}\n${rawSeq}\n`;
        const decodeResult = DNAEngineerService.decode(fastaForDecode);
        if (decodeResult && decodeResult.success && decodeResult.decoded === originalPayload) {
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
    let allSimulations;
    try {
      allSimulations = await StorageService.getAll("simulations");
    } catch (parseErr) {
      return res.status(422).json({
        error: "simulations.json is corrupted",
        details: parseErr.message
      });
    }

    // Use all simulations as multi-user auth and userId-based filtering are completely removed
    const simulations = allSimulations;

    const scanned_count = simulations.length;
    let corrupted_found = 0;
    let fixed_count = 0;
    const details = [];

    for (const sim of simulations) {
      const simId = sim.id || "";
      const simName = sim.name || sim.title || "";
      const currentSequence = sim.sequence || sim.seq || sim.dna || "";
      const expectedChecksum = sim.checksum || sim.hash || sim.expectedHash || "";

      // 1. Run checksum verification first to detect if block is corrupted.
      const isCorrupted = !verifySimulationChecksum(sim);

      if (!isCorrupted) {
        // Block is valid and healthy.
        details.push({
          id: simId,
          name: simName,
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
        // Step A1: Parallel triplicates majority-vote restore.
        const triplicates = sim.triplicates || sim.triplicate || [];
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
            console.log(`[DNA Health Check] Successfully repaired simulation ${simId} via parallel character majority-vote.`);
          } else {
            console.warn(`[DNA Health Check] Character majority-vote failed for simulation ${simId}: Reconstructed sequence did not match expected checksum.`);
          }
        }

        // Step A2: Inline triplication majority-vote restore.
        if (!fixed && currentSequence) {
          let reconstructedRepeated = "";
          let reconstructedSingle = "";
          for (let i = 0; i < currentSequence.length; i += 3) {
            const chunk = currentSequence.slice(i, i + 3);
            const char1 = chunk[0] || "";
            const char2 = chunk[1] || "";
            const char3 = chunk[2] || "";

            const counts = {};
            if (char1) counts[char1] = (counts[char1] || 0) + 1;
            if (char2) counts[char2] = (counts[char2] || 0) + 1;
            if (char3) counts[char3] = (counts[char3] || 0) + 1;

            let majorityChar = "";
            let maxCount = 0;
            for (const [char, count] of Object.entries(counts)) {
              if (count > maxCount) {
                maxCount = count;
                majorityChar = char;
              }
            }
            if (majorityChar) {
              reconstructedRepeated += majorityChar + majorityChar + majorityChar;
              reconstructedSingle += majorityChar;
            }
          }

          const tempSimRepeated = { ...sim, sequence: reconstructedRepeated };
          if (reconstructedRepeated && verifySimulationChecksum(tempSimRepeated)) {
            sim.sequence = reconstructedRepeated;
            fixed_count++;
            fixed = true;
            finalSequence = reconstructedRepeated;
            recoveryMethod = "inline_triplication_majority_vote";
            await StorageService.save("simulations", sim);
            console.log(`[DNA Health Check] Successfully repaired simulation ${simId} via inline character majority-vote (repeated).`);
          } else {
            const tempSimSingle = { ...sim, sequence: reconstructedSingle };
            if (reconstructedSingle && verifySimulationChecksum(tempSimSingle)) {
              sim.sequence = reconstructedSingle;
              fixed_count++;
              fixed = true;
              finalSequence = reconstructedSingle;
              recoveryMethod = "inline_triplication_majority_vote_single";
              await StorageService.save("simulations", sim);
              console.log(`[DNA Health Check] Successfully repaired simulation ${simId} via inline character majority-vote (single).`);
            }
          }
        }

        // Step B (Fallback): Re-encode from original backup copy / redundant data.
        const originalPayload = sim.original || sim.payload || "";
        if (!fixed && originalPayload) {
          try {
            const regenerated = DNAEngineerService.encode(originalPayload, sim.strategy || "base4");
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
                console.log(`[DNA Health Check] Successfully self-healed simulation ${simId} by re-encoding original redundant backup copy.`);
              }
            }
          } catch (encodeErr) {
            console.error(`[DNA Health Check] Fallback repair failed for simulation ${simId}:`, encodeErr.message);
          }
        }

        // 4. Only after this full cycle, show ONE final, clear status per block.
        if (fixed) {
          details.push({
            id: simId,
            name: simName,
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

          // If expectedChecksum is legacy (64-char hex) or missing, map to legacy_unverified
          const isLegacy = !expectedChecksum || (expectedChecksum.length === 64 && /^[0-9a-fA-F]+$/.test(expectedChecksum));
          if (isLegacy) {
            details.push({
              id: simId,
              corrupted_id: simId,
              name: simName,
              status: "legacy_unverified",
              recovery_status: "Legacy Unverified",
              reason: "legacy checksum format - unverified"
            });
            console.log(`[DNA Health Check] Simulation ${simId} has legacy/missing checksum, mapped to legacy_unverified.`);
          } else {
            details.push({
              id: simId,
              corrupted_id: simId,
              name: simName,
              status: "corrupted_unfixable",
              recovery_status: "Unrecoverable",
              reason: reason
            });
            console.error(`[DNA Health Check] Simulation ${simId} is corrupted and unfixable (${reason}).`);
          }
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
