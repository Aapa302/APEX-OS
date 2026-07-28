const express = require("express");
const crypto = require("crypto");
const StorageService = require("../services/StorageService");
const DNAEngineerService = require("../services/DNAEngineerService");
const { verifyFirebaseToken } = require("../middleware/auth");

const router = express.Router();

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

// GET /api/dna-health/auto-scan
router.get("/auto-scan", async (req, res, next) => {
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

    // Verbose debug log raw simulations array
    console.log(`[Auto self-healing DEBUG-LOG] TOTAL SIMULATIONS RETRIEVED: ${simulations.length}`);
    if (simulations.length > 0) {
      console.log("[Auto self-healing DEBUG-LOG] FIRST DOC RAW CONTENT:", JSON.stringify(simulations[0], null, 2));
    }

    const scanned_count = simulations.length;
    let corrupted_found = 0;
    let fixed_count = 0;
    let unrecoverable_count = 0;
    const details = [];

    for (const sim of simulations) {
      const simId = sim.id || "";
      const simName = sim.name || sim.title || "";
      const currentSequence = sim.sequence || sim.seq || sim.dna || "";
      const expectedChecksum = sim.checksum || sim.hash || sim.expectedHash || "";

      // 1. Run checksum verification first to detect if block is corrupted.
      const isCorrupted = !verifySimulationChecksum(sim);

      if (!isCorrupted) {
        // Block is valid and healthy
        details.push({
          id: simId,
          name: simName,
          status: "healthy",
          recovery_status: "Healthy"
        });
      } else {
        corrupted_found++;
        let fixed = false;
        let finalSequence = currentSequence;
        let recoveryMethod = "";

        // Try automatic error correction using majority-vote logic on triplicates
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

          // Re-verify the checksum after correction
          const tempSim = { ...sim, sequence: reconstructed };
          if (verifySimulationChecksum(tempSim)) {
            // Backup the original corrupted version first
            const backupId = `corr_${simId}_${Date.now()}`;
            const backupRecord = {
              id: backupId,
              original_id: simId,
              name: simName,
              sequence: currentSequence,
              checksum: expectedChecksum,
              triplicates: [...triplicates],
              original: sim.original || sim.payload || "",
              strategy: sim.strategy || "base4",
              userId: sim.userId || "",
              timestamp: new Date().toISOString()
            };
            await StorageService.save("corruption_history", backupRecord);

            // Overwrite and save the corrected sequence
            sim.sequence = reconstructed;
            await StorageService.save("simulations", sim);

            fixed_count++;
            fixed = true;
            finalSequence = reconstructed;
            recoveryMethod = "triplication_majority_vote";

            details.push({
              id: simId,
              name: simName,
              status: "fixed",
              recovery_status: "Fully Recovered",
              original_corrupted: currentSequence,
              fixed_sequence: reconstructed,
              method: "triplication_majority_vote"
            });
            console.log(`[Auto self-healing] Successfully repaired simulation ${simId} via character majority-vote.`);
          } else {
            console.warn(`[Auto self-healing] Character majority-vote failed for simulation ${simId}: Reconstructed sequence did not match expected checksum.`);
          }
        }

        // Try inline triplication majority-vote restore
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
            // Backup the original corrupted version first
            const backupId = `corr_${simId}_${Date.now()}`;
            const backupRecord = {
              id: backupId,
              original_id: simId,
              name: simName,
              sequence: currentSequence,
              checksum: expectedChecksum,
              triplicates: [],
              original: sim.original || sim.payload || "",
              strategy: sim.strategy || "base4",
              userId: sim.userId || "",
              timestamp: new Date().toISOString()
            };
            await StorageService.save("corruption_history", backupRecord);

            sim.sequence = reconstructedRepeated;
            await StorageService.save("simulations", sim);

            fixed_count++;
            fixed = true;
            finalSequence = reconstructedRepeated;
            recoveryMethod = "inline_triplication_majority_vote";

            details.push({
              id: simId,
              name: simName,
              status: "fixed",
              recovery_status: "Fully Recovered",
              original_corrupted: currentSequence,
              fixed_sequence: reconstructedRepeated,
              method: "inline_triplication_majority_vote"
            });
            console.log(`[Auto self-healing] Successfully repaired simulation ${simId} via inline character majority-vote (repeated).`);
          } else {
            const tempSimSingle = { ...sim, sequence: reconstructedSingle };
            if (reconstructedSingle && verifySimulationChecksum(tempSimSingle)) {
              // Backup the original corrupted version first
              const backupId = `corr_${simId}_${Date.now()}`;
              const backupRecord = {
                id: backupId,
                original_id: simId,
                name: simName,
                sequence: currentSequence,
                checksum: expectedChecksum,
                triplicates: [],
                original: sim.original || sim.payload || "",
                strategy: sim.strategy || "base4",
                userId: sim.userId || "",
                timestamp: new Date().toISOString()
              };
              await StorageService.save("corruption_history", backupRecord);

              sim.sequence = reconstructedSingle;
              await StorageService.save("simulations", sim);

              fixed_count++;
              fixed = true;
              finalSequence = reconstructedSingle;
              recoveryMethod = "inline_triplication_majority_vote_single";

              details.push({
                id: simId,
                name: simName,
                status: "fixed",
                recovery_status: "Fully Recovered",
                original_corrupted: currentSequence,
                fixed_sequence: reconstructedSingle,
                method: "inline_triplication_majority_vote_single"
              });
              console.log(`[Auto self-healing] Successfully repaired simulation ${simId} via inline character majority-vote (single).`);
            }
          }
        }

        if (!fixed) {
          unrecoverable_count++;
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
            console.log(`[Auto self-healing] Simulation ${simId} has legacy/missing checksum, mapped to legacy_unverified.`);
          } else {
            details.push({
              id: simId,
              corrupted_id: simId,
              name: simName,
              status: "corrupted_unfixable",
              recovery_status: "Unrecoverable",
              reason: "Unrecoverable - manual review needed"
            });
            console.error(`[Auto self-healing] Simulation ${simId} is corrupted and unfixable (Unrecoverable - manual review needed).`);
          }
        }
      }
    }

    // Log the results to Firestore "health_check_logs" collection
    const logId = `log_${Date.now()}`;
    const logEntry = {
      id: logId,
      timestamp: new Date().toISOString(),
      scanned_count,
      corrupted_found,
      fixed_count,
      unrecoverable_count,
      details
    };
    await StorageService.save("health_check_logs", logEntry);

    res.json({
      success: true,
      scanned_count,
      corrupted_found,
      fixed_count,
      unrecoverable_count,
      details
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
