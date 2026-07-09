// ════════════════════════════════════════════════════════════
// Route: POST /v1/export/github
//
// Handles GitHub API calls server-side to bypass CSP restrictions
// in the browser (especially inside Claude.ai artifacts).
// ════════════════════════════════════════════════════════════

const express = require("express");
const { logger } = require("../middleware/logger");

const router = express.Router();

router.post("/github", async (req, res, next) => {
  const { token, owner, repo, branch, files, commitMessage } = req.body;

  if (!token || !owner || !repo || !files || !Array.isArray(files)) {
    return res.status(400).json({
      error: {
        type: "invalid_request",
        message: "Missing required fields: token, owner, repo, and files are mandatory.",
      },
    });
  }

  logger.info(`Exporting to GitHub: ${owner}/${repo}@${branch || "main"}`);

  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "APEX-Gemini-Proxy",
    };

    const results = [];
    const targetBranch = branch || "main";

    for (const file of files) {
      const contentB64 = Buffer.from(file.content || "").toString("base64");
      let sha;

      // Check if file exists to get its SHA (required for updates)
      try {
        const getRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(file.path)}?ref=${targetBranch}`,
          { headers }
        );
        if (getRes.ok) {
          const j = await getRes.json();
          sha = j.sha;
        }
      } catch (e) {
        logger.warn(`Could not check existence of ${file.path}`, e.message);
      }

      const putRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(file.path)}`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({
            message: commitMessage || `Update ${file.path} via APEX OS`,
            content: contentB64,
            branch: targetBranch,
            ...(sha ? { sha } : {}),
          }),
        }
      );

      if (!putRes.ok) {
        const errText = await putRes.text();
        throw new Error(`GitHub API failed for ${file.path}: ${putRes.status} ${errText}`);
      }
      results.push(file.path);
    }

    res.json({
      success: true,
      message: `Successfully pushed ${results.length} files to ${owner}/${repo}@${targetBranch}`,
      files: results,
    });
  } catch (err) {
    logger.error("GitHub export failed", err.message);
    next(err);
  }
});

module.exports = router;
