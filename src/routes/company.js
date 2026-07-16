// ════════════════════════════════════════════════════════════
// Router: /api/company
// Express endpoints for APEX OS Company Orchestrator.
// ════════════════════════════════════════════════════════════

const express = require("express");
const CompanyOrchestratorService = require("../services/CompanyOrchestratorService");
const { logger } = require("../middleware/logger");

const router = express.Router();

router.post("/report", (req, res, next) => {
  try {
    logger.info("Company Readiness Report requested.");
    const result = CompanyOrchestratorService.generateReadinessReport(req.body);
    res.json(result);
  } catch (err) {
    logger.error("Readiness report compiling error", err.message);
    res.status(500).json({
      error: {
        type: "report_error",
        message: err.message
      }
    });
  }
});

router.post("/execute-task", (req, res, next) => {
  const { taskName, agentId } = req.body;

  if (!taskName || !agentId) {
    return res.status(400).json({
      error: {
        type: "invalid_request",
        message: "Missing 'taskName' or 'agentId' parameters."
      }
    });
  }

  try {
    logger.info(`Orchestrated autonomous task execution for '${taskName}' requested.`);
    const result = CompanyOrchestratorService.executeAutonomousTask(taskName, agentId);
    res.json(result);
  } catch (err) {
    logger.error("Task execution simulation error", err.message);
    res.status(500).json({
      error: {
        type: "execution_error",
        message: err.message
      }
    });
  }
});

module.exports = router;
