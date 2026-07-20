const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const DNAEngineerService = require("../services/DNAEngineerService");

const router = express.Router();
const SIMULATIONS_FILE = path.join(__dirname, "../../simulations.json");

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
    let simulations = [];
    try {
      const data = await fs.readFile(SIMULATIONS_FILE, "utf8");
      simulations = JSON.parse(data);
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }

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
        // Default base4 encoding match
        // Or generic strategy-based encoding match
        try {
          const encoded = DNAEngineerService.encode(query, strategy);
          if (encoded && encoded.success && encoded.sequence) {
            matchPos = sequence.indexOf(encoded.sequence);
          }
        } catch (encodeErr) {
          // Fallback to base4 encoding
          const encodedBase4 = DNAEngineerService.encode(query, "base4");
          if (encodedBase4 && encodedBase4.success && encodedBase4.sequence) {
            matchPos = sequence.indexOf(encodedBase4.sequence);
          }
        }
      }

      if (matchPos !== -1) {
        matches.push({
          sequence_id: sim.id,
          position: matchPos,
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
