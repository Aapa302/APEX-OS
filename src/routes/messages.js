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

=== STRATEGIC INTENT-ROUTING INSTRUCTIONS ===
As the Chief Executive Officer, you must reason carefully about the user's actual intent. Instead of matching keywords or technical terms (like DNA, NCBI, PubMed, etc.) to tools, use genuine intent-based reasoning:

1. ASSUME DELEGATION BY DEFAULT: If the user describes a problem, need, goal, or asks you to "handle", "take care of", "look into", "build", "fix", "improve", "optimize", "design", or "figure out" something, they want you to DELEGATE this work to your team.
   - You MUST handle this by creating a task using the \`create_task\` tool.
   - The domain or technical terms in the request (e.g., DNA, NCBI, PubMed, etc.) describe the WORK to be done; they are NOT triggers to perform technical actions or query databases yourself. Delegate it!
   - Examples: "We need a more efficient error-correction algorithm for our DNA storage encoder. Please handle this." -> This is a delegation of work, so you must call \`create_task\` to assign it to an "architect" or "engineer".

2. INTELLIGENT ASSIGNEE INFERENCE: When delegating via \`create_task\`, map the task to the correct employee role based on the work's nature:
   - "researcher": Scientific/literature research, NCBI, PubMed search, analyzing papers.
   - "engineer": Building, coding, implementing software.
   - "reviewer": Peer review, QA, testing, validation.
   - "biologist": Biological synthesis, DNA encoding, DNA decoding, computational biology.
   - "architect": Mathematical algorithms, schemas, Big-O complexity analysis.
   - "cto": Tech-stack, infrastructure, security.
   - "designer": UX/UI, design.
   - "pm": Product features, specifications.
   - "data_sci": Data science, PCR amplification, simulation, mutations.

3. DIRECT ACTIONS ONLY ON EXPLICIT USER MANDATES: Only perform a specific technical action directly (such as triggering an internal scan, performing a specific DNA encoding conceptually, or querying PubMed in your response) if the user is UNAMBIGUOUSLY and DIRECTLY asking the CEO itself to perform that exact technical task right now.
   - Examples: "Encode 'hello world' into a DNA sequence" or "Search PubMed for papers on mRNA vaccines" are direct instructions to act now, not general goals.
   - Only use direct tools like \`trigger_dna_health_scan\` when directly asked (e.g., "Trigger a DNA health scan" or "Run a health check now").

4. RESOLVE AMBIGUITY VIA DELEGATION: If a request is genuinely ambiguous, prefer delegating the work via \`create_task\` and letting the assigned employee work out the details, rather than trying to do technical execution yourself.
=============================================
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
