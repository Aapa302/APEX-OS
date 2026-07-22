const express = require("express");
const StorageService = require("../services/StorageService");
const { db } = require("../firebase");

const router = express.Router();

router.get("/list-simulations", async (req, res, next) => {
  try {
    if (db) {
      console.log("[Debug Route] [DEBUG-LOG] Querying Firestore for simulations collection directly.");
      const snapshot = await db.collection("simulations").get();
      const list = [];
      snapshot.forEach(doc => {
        const sim = doc.data();
        list.push({
          id: doc.id || sim.id,
          name: sim.name || sim.title || "",
          timestamp: sim.timestamp || sim.createdAt || sim.date || null
        });
      });
      res.json(list);
    } else {
      console.log("[Debug Route] [DEBUG-LOG] Firestore is not enabled. Falling back to StorageService and local disk JSON.");
      const list = await StorageService.getAll("simulations");
      const result = list.map(sim => {
        return {
          id: sim.id,
          name: sim.name || sim.title || "",
          timestamp: sim.timestamp || sim.createdAt || sim.date || null
        };
      });
      res.json(result);
    }
  } catch (error) {
    console.error("[Debug Route] Error fetching simulations list:", error);
    next(error);
  }
});

module.exports = router;
