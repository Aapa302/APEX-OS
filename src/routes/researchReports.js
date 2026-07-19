const express = require("express");
const fs = require("fs").promises;
const path = require("path");

const router = express.Router();
const REPORTS_FILE = path.join(__dirname, "../../research-reports.json");

// Helper to load research reports
async function readReports() {
  try {
    const data = await fs.readFile(REPORTS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(REPORTS_FILE, JSON.stringify([], null, 2));
      return [];
    }
    throw error;
  }
}

// Helper to save research reports
async function writeReports(reports) {
  const tempPath = REPORTS_FILE + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(reports, null, 2));
  await fs.rename(tempPath, REPORTS_FILE);
}

// GET /research-reports — returns all reports
router.get("/", async (req, res, next) => {
  try {
    const reports = await readReports();
    res.json(reports);
  } catch (error) {
    next(error);
  }
});

// POST /research-reports — appends a new report
router.post("/", async (req, res, next) => {
  try {
    const { report } = req.body;

    if (!report || !report.query) {
      return res.status(400).json({ error: "Report payload with query is required." });
    }

    const reports = await readReports();
    reports.unshift(report); // Put latest on top
    await writeReports(reports);

    res.status(201).json(report);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
