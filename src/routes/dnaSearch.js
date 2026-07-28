const express = require("express");
const StorageService = require("../services/StorageService");
const DNAEngineerService = require("../services/DNAEngineerService");
const { verifyFirebaseToken } = require("../middleware/auth");

const router = express.Router();

// Require auth
router.use(verifyFirebaseToken);

// Helper to convert string to bits
function stringToBits(str) {
  const bytes = Buffer.from(str, "utf8");
  let bits = "";
  for (let i = 0; i < bytes.length; i++) {
    bits += bytes[i].toString(2).padStart(8, "0");
  }
  return bits;
}

// POST /api/search-dna — searches for query text inside stored simulations with rotation-aware matching
router.post("/", async (req, res, next) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        error: {
          type: "invalid_request",
          message: "Missing or invalid required parameter: 'query' must be a non-empty string."
        }
      });
    }

    // Read simulations
    const allSimulations = await StorageService.getAll("simulations");

    // Use all simulations as multi-user auth and userId-based filtering are completely removed
    const simulations = allSimulations;

    const matches = [];

    for (const sim of simulations) {
      const sequence = sim.sequence || "";
      const strategy = sim.strategy || "base4";
      let matchPos = -1;

      if (strategy === "homopolymer-safe") {
        // Rotation-aware matching for homopolymer-safe:
        // Try all 4 possible preceding base seeds
        const BASES = ["A", "C", "G", "T"];
        const bits = stringToBits(query);

        for (const seed of BASES) {
          let pattern = "";
          let prev = seed;
          for (let i = 0; i < bits.length; i++) {
            const bit = bits[i];
            const prevIdx = BASES.indexOf(prev);
            const shift = bit === "0" ? 1 : 2;
            const current = BASES[(prevIdx + shift) % 4];
            pattern += current;
            prev = current;
          }

          const idx = sequence.indexOf(pattern);
          if (idx !== -1) {
            matchPos = idx;
            break;
          }
        }
      } else {
        // Default strategy-based encoding match
        try {
          const encoded = DNAEngineerService.encode(query, strategy);
          if (encoded && encoded.success && encoded.sequence) {
            matchPos = sequence.indexOf(encoded.sequence);
          }
        } catch (encodeErr) {
          // Fallback to base4 encoding
          try {
            const encodedBase4 = DNAEngineerService.encode(query, "base4");
            if (encodedBase4 && encodedBase4.success && encodedBase4.sequence) {
              matchPos = sequence.indexOf(encodedBase4.sequence);
            }
          } catch (fbErr) {
            // Ignore
          }
        }
      }

      if (matchPos !== -1) {
        let full_decoded_context = "";
        try {
          const decodeResult = DNAEngineerService.decode(sequence, strategy);
          if (decodeResult && decodeResult.success) {
            full_decoded_context = decodeResult.decoded;
          }
        } catch (decErr) {
          // Ignore and use fallback
        }

        // Fallback to original field if decoded context is empty
        if (!full_decoded_context && sim.original) {
          full_decoded_context = sim.original;
        }

        matches.push({
          sequence_id: sim.id,
          position: matchPos,
          full_decoded_context,
          timestamp: new Date().toISOString()
        });
      }
    }

    res.json({
      found: matches.length > 0,
      matches
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
