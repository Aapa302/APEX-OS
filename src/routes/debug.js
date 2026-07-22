const express = require("express");
const StorageService = require("../services/StorageService");

const router = express.Router();

router.get("/list-simulations", async (req, res, next) => {
  try {
    const list = await StorageService.getAll("simulations");
    const result = list.map(sim => {
      return {
        id: sim.id,
        name: sim.name || sim.title || "",
        timestamp: sim.timestamp || sim.createdAt || sim.date || null
      };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
