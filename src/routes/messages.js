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
const { generateContent } = require("../services/geminiService");
const { logger } = require("../middleware/logger");
const config = require("../config/env");

const router = express.Router();

router.get("/", (req, res) => res.json({ message: "APEX Gemini Proxy /v1/messages is active." }));

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
    const result = await generateContent(messages, system || "", {
      maxTokens: max_tokens || 1000,
      temperature,
      top_p,
      jsonMode: false,
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
    const result = await generateContent(messages, system || "", {
      maxTokens: max_tokens || 1000,
      temperature,
      top_p,
      jsonMode: true,
    });

    res.json({
      id: `proxy_json_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: result.model,
      provider: result.provider,
      content: result.content,
      stop_reason: "end_turn",
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
