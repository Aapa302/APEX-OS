const express = require("express");
const crypto = require("crypto");
const StorageService = require("../services/StorageService");

const router = express.Router();

// Helper to compute sha256
function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

// GET /api/dna-health/auto-scan
router.get("/auto-scan", async (req, res, next) => {
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
    let unrecoverable_count = 0;
    const details = [];

    for (const sim of simulations) {
      const currentSequence = sim.sequence || "";
      const expectedChecksum = sim.checksum || "";
      const currentHash = sha256(currentSequence);

      const isCorrupted = !expectedChecksum || (currentHash !== expectedChecksum);

      if (!isCorrupted) {
        // Block is valid and healthy
        details.push({
          id: sim.id,
          name: sim.name,
          status: "healthy",
          recovery_status: "Healthy"
        });
      } else {
        corrupted_found++;
        let fixed = false;
        let finalSequence = currentSequence;

        // Try automatic error correction using majority-vote logic on triplicates
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

          // Re-verify the checksum after correction
          const reconstructedHash = sha256(reconstructed);
          if (reconstructedHash === expectedChecksum) {
            // Backup the original corrupted version first
            const backupId = `corr_${sim.id}_${Date.now()}`;
            const backupRecord = {
              id: backupId,
              original_id: sim.id,
              name: sim.name,
              sequence: currentSequence,
              checksum: expectedChecksum,
              triplicates: [...triplicates],
              original: sim.original || "",
              strategy: sim.strategy || "base4",
              timestamp: new Date().toISOString()
            };
            await StorageService.save("corruption_history", backupRecord);

            // Overwrite and save the corrected sequence
            sim.sequence = reconstructed;
            await StorageService.save("simulations", sim);

            fixed_count++;
            fixed = true;
            finalSequence = reconstructed;

            details.push({
              id: sim.id,
              name: sim.name,
              status: "fixed",
              recovery_status: "Fully Recovered",
              original_corrupted: currentSequence,
              fixed_sequence: reconstructed,
              method: "triplication_majority_vote"
            });
            console.log(`[Auto self-healing] Successfully repaired simulation ${sim.id} via character majority-vote.`);
          } else {
            console.warn(`[Auto self-healing] Character majority-vote failed for simulation ${sim.id}: Reconstructed sequence did not match expected checksum.`);
          }
        }

        if (!fixed) {
          unrecoverable_count++;
          details.push({
            id: sim.id,
            corrupted_id: sim.id,
            name: sim.name,
            status: "corrupted_unfixable",
            recovery_status: "Unrecoverable",
            reason: "Unrecoverable - manual review needed"
          });
          console.error(`[Auto self-healing] Simulation ${sim.id} is corrupted and unfixable (Unrecoverable - manual review needed).`);
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
