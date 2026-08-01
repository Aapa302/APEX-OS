const express = require("express");
const { pushToGitHub, deployToRender } = require("../services/deploymentService");
const { logger } = require("../middleware/logger");

const router = express.Router({ mergeParams: true });

router.post("/", async (req, res, next) => {
  const { projectName, files } = req.body;
  const buildId = req.params.id;

  logger.info(`Received deployment request for build: ${buildId}, projectName: ${projectName}`);

  // 1. Check for required environment variables
  const missingVars = [];
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_TOKEN.trim()) {
    missingVars.push("GITHUB_TOKEN");
  }
  if (!process.env.RENDER_API_KEY || !process.env.RENDER_API_KEY.trim()) {
    missingVars.push("RENDER_API_KEY");
  }

  if (missingVars.length > 0) {
    return res.status(400).json({
      error: {
        type: "missing_credentials",
        message: `Deployment failed. Missing required environment variables: ${missingVars.join(", ")}. Please configure them in your environment dashboard.`,
        missingVariables: missingVars,
      },
    });
  }

  // 2. Validate input parameters
  if (!projectName || !projectName.trim()) {
    return res.status(400).json({
      error: {
        type: "invalid_request",
        message: "Missing required parameter: 'projectName' is mandatory.",
      },
    });
  }

  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({
      error: {
        type: "invalid_request",
        message: "Missing required parameter: 'files' array is mandatory and must not be empty.",
      },
    });
  }

  try {
    // A. Push to GitHub
    logger.info(`Starting GitHub push for project ${projectName}...`);
    const githubUrl = await pushToGitHub(projectName, files);

    // B. Deploy to Render
    logger.info(`GitHub push completed successfully. Starting Render deployment for ${githubUrl}...`);
    const renderUrl = await deployToRender(githubUrl, projectName);

    logger.info(`Deployment successfully completed for build ${buildId}!`);
    return res.json({
      success: true,
      githubUrl,
      renderUrl,
      message: `Build ${buildId} deployed successfully! GitHub: ${githubUrl}, Render: ${renderUrl}`,
    });
  } catch (err) {
    logger.error(`Deployment failed for build ${buildId}: ${err.message}`, err);
    return res.status(500).json({
      error: {
        type: "deployment_failed",
        message: err.message,
      },
    });
  }
});

module.exports = router;
