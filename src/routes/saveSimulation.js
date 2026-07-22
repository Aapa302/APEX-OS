const express = require("express");
const StorageService = require("../services/StorageService");

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const { name, sequence, checksum } = req.body;

    // Validate mandatory parameters (sequence and checksum)
    if (!sequence || typeof sequence !== "string" || !checksum || typeof checksum !== "string") {
      return res.status(400).json({
        error: {
          type: "invalid_request",
          message: "Missing or invalid required parameters: 'sequence' and 'checksum' must be non-empty strings."
        }
      });
    }

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
      checksum,
      triplicates: [sequence, sequence, sequence], // Standard triplicates
      original: "", // Can be filled or left empty
      strategy: "base4", // Default strategy
      timestamp: timestampValue
    };

    // Save the new record
    await StorageService.save("simulations", newRecord);

    res.json({
      success: true,
      id: newId
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
