const express = require("express");
const StorageService = require("../services/StorageService");
const { verifyFirebaseToken } = require("../middleware/auth");

const router = express.Router();

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

// Clean raw nucleotide sequence
function getCleanSequence(currentSequence) {
  let rawSeq = currentSequence.trim();
  if (rawSeq.startsWith(">")) {
    const lines = rawSeq.split("\n");
    rawSeq = lines.slice(1).join("").replace(/[^ACGTacgt]/g, "");
  } else {
    rawSeq = rawSeq.replace(/[^ACGTacgt]/g, "");
  }
  return rawSeq.toUpperCase();
}

// Require Firebase token verification
router.use(verifyFirebaseToken);

router.post("/", async (req, res, next) => {
  try {
    console.log(`[Save Simulation] [DEBUG-LOG] Received request body name field: "${req.body.name}"`, typeof req.body.name);
    console.log(`[Save Simulation] [DEBUG-LOG] Full incoming request body:`, JSON.stringify(req.body));
    const { name, sequence } = req.body;

    // Validate mandatory parameters (sequence)
    if (!sequence || typeof sequence !== "string") {
      return res.status(400).json({
        error: {
          type: "invalid_request",
          message: "Missing or invalid required parameters: 'sequence' must be a non-empty string."
        }
      });
    }

    // Backend automatically computes the CRC32 checksum over the cleaned raw sequence
    const cleanedSeq = getCleanSequence(sequence);
    const calculatedChecksum = crc32(cleanedSeq);

    // Resolve name: prioritize user-entered name if present, fallback to auto-generated SEQ_ timestamp name
    let finalName = name;
    if (!finalName || typeof finalName !== "string" || finalName.trim() === "") {
      finalName = `SEQ_${Date.now()}`;
      console.log(`[Save Simulation] Name field is blank or missing. Falling back to auto-generated name: "${finalName}"`);
    } else {
      finalName = finalName.trim();
      console.log(`[Save Simulation] Using user-provided custom name: "${finalName}"`);
    }

    // Read existing simulations
    const simulations = await StorageService.getAll("simulations");

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

    // Safely resolve Firestore FieldValue if available
    let FieldValue;
    try {
      FieldValue = require("firebase-admin/firestore").FieldValue;
    } catch (e) {
      // Ignore
    }
    const timestampValue = (FieldValue && FieldValue.serverTimestamp)
      ? FieldValue.serverTimestamp()
      : new Date().toISOString();

    // Create the new simulation record
    const newRecord = {
      id: newId,
      name: finalName,
      sequence,
      checksum: calculatedChecksum,
      triplicates: [sequence, sequence, sequence], // Standard triplicates
      original: "", // Can be filled or left empty
      strategy: "base4", // Default strategy
      timestamp: timestampValue
    };

    // Save the new record
    await StorageService.save("simulations", newRecord);

    res.json({
      success: true,
      id: newId,
      checksum: calculatedChecksum
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
