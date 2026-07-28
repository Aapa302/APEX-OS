// ════════════════════════════════════════════════════════════
// Route: POST /v1/messages
//
// Accepts exactly the same request body the APEX OS frontend
// sends to Claude (model, max_tokens, system, messages), calls
// Gemini, and returns an Anthropic-shaped response.
//
// This intentional API shape means the only change needed in
// the frontend is the URL — no message-building logic changes.
// ════════════════════════════════════════════════════════════

const express = require("express");
const { validateMessagesBody } = require("../middleware/validate");
const { generateContent, listModels } = require("../services/geminiService");
const { logger } = require("../middleware/logger");
const config = require("../config/env");

const router = express.Router();

router.get("/", (req, res) => res.json({ message: "APEX Gemini Proxy /v1/messages is active." }));

// Helper to auto-inject state context into system prompt
async function injectStateContext(system, req) {
  const isCeo = system && (
    system.includes("You are APEX") ||
    system.includes("AI CEO") ||
    system.toLowerCase().includes("apex") ||
    system.toLowerCase().includes("ceo")
  );

  if (!isCeo) {
    return system || "";
  }

  try {
    const StorageService = require("../services/StorageService");
    const path = require("path");
    const fs = require("fs").promises;

    // Retrieve all tasks (all tasks are processed without any userId filtering or user isolation)
    const tasks = await StorageService.getAll("tasks");

    const totalTasks = tasks.length;
    const todoTasks = tasks.filter(t => t.column === 'todo' || t.status === 'todo').length;
    const inprogressTasks = tasks.filter(t => t.column === 'inprogress' || t.status === 'inprogress').length;
    const reviewTasks = tasks.filter(t => t.column === 'review' || t.status === 'review').length;
    const doneTasks = tasks.filter(t => t.column === 'done' || t.status === 'done').length;

    let latestHealth = "No health check run yet.";
    try {
      const logsFile = path.join(__dirname, "../../dna-health-logs.json");
      const logData = await fs.readFile(logsFile, "utf8");
      const logs = JSON.parse(logData);
      if (logs && logs.length > 0) {
        const latest = logs[logs.length - 1];
        let unrecoverable = latest.unrecoverable_count;
        if (unrecoverable === undefined && latest.details) {
          unrecoverable = latest.details.filter(d => d.status === "corrupted_unfixable" || d.recovery_status === "Unrecoverable").length;
        }
        latestHealth = `Timestamp: ${latest.timestamp}, Scanned: ${latest.scanned_count}, Corrupted Found: ${latest.corrupted_found}, Fixed/Recovered: ${latest.fixed_count}, Unrecoverable: ${unrecoverable || 0}`;
      }
    } catch (err) {
      // Ignore
    }

    const autoContext = `
[SYSTEM STATE CONTEXT]
- Current Tasks Count: Total=${totalTasks} (To Do=${todoTasks}, In Progress=${inprogressTasks}, Review=${reviewTasks}, Done=${doneTasks})
- Latest DNA Health Status: ${latestHealth}
`;
    return system ? `${system}\n${autoContext}` : autoContext;
  } catch (err) {
    console.error("[Context Auto-Injection Error]", err);
    return system || "";
  }
}

// ── POST /v1/messages ────────────────────────────────────────
router.post("/", validateMessagesBody, async (req, res, next) => {
  const { messages, system, max_tokens, model, temperature, top_p } = req.body;

  logger.info("POST /v1/messages", {
    messageCount: messages.length,
    hasSystem: !!system,
    max_tokens: max_tokens || 1000,
    requestedModel: model || "(not specified)",
  });

  try {
    const enrichedSystem = await injectStateContext(system || "", req);

    const result = await generateContent(messages, enrichedSystem, {
      maxTokens: max_tokens || 1000,
      temperature,
      top_p,
      jsonMode: false,
      authHeader: req.headers.authorization || "",
    });

    // Anthropic-compatible response envelope
    res.json({
      id: `proxy_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: result.model,
      provider: result.provider,
      content: result.content,
      stop_reason: "end_turn",
      usage: { input_tokens: null, output_tokens: null }, // not available from Gemini REST
      ...(result.queued ? { queued: true, queueWaitMs: result.queueWaitMs } : {})
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /v1/messages/test-gemini ──────────────────────────────
// Diagnostic endpoint to verify Gemini API key and quota
router.all("/test-gemini", async (req, res) => {
  try {
    const result = await generateContent(
      [{ role: "user", content: "Say 'Gemini is Online'" }],
      "You are a diagnostic tool.",
      { maxTokens: 20, jsonMode: false }
    );
    res.json({
      success: true,
      message: "Gemini API is working correctly.",
      model: config.geminiModel,
      response: result.content,
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message,
      details: err.details || null,
    });
  }
});

// ── GET /v1/messages/list-models ──────────────────────────────
// Diagnostic endpoint to see which models this API key has access to
router.get("/list-models", async (req, res) => {
  try {
    const models = await listModels();
    res.json({ success: true, count: models.length, models });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message,
    });
  }
});

// ── POST /v1/messages/json ────────────────────────────────────
// Separate endpoint for calls that expect a pure JSON response
// (used by callClaudeJSON / the Planner and Reviewer code paths).
// The frontend can call this via callAIJSON once updated.
router.post("/json", validateMessagesBody, async (req, res, next) => {
  const { messages, system, max_tokens, temperature, top_p } = req.body;

  logger.info("POST /v1/messages/json", {
    messageCount: messages.length,
    hasSystem: !!system,
    max_tokens: max_tokens || 1000,
  });

  try {
    const enrichedSystem = await injectStateContext(system || "", req);

    const result = await generateContent(messages, enrichedSystem, {
      maxTokens: max_tokens || 1000,
      temperature,
      top_p,
      jsonMode: true,
      authHeader: req.headers.authorization || "",
    });

    res.json({
      id: `proxy_json_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: result.model,
      provider: result.provider,
      content: result.content,
      stop_reason: "end_turn",
      ...(result.queued ? { queued: true, queueWaitMs: result.queueWaitMs } : {})
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
