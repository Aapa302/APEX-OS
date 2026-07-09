// ════════════════════════════════════════════════════════════
// APEX OS — Gemini Proxy Backend
// Entry point: creates and starts the Express server.
//
// Architecture overview:
//   Browser (APEX-OS-v4.jsx)
//       └──► POST const PROXY_BASE_URL = "https://apex-os-nztm.onrender.com";v1/messages
//                └──► src/routes/messages.js
//                         └──► src/services/geminiService.js
//                                  └──► Gemini REST API
//
// The proxy accepts Anthropic-shaped requests (same format the
// frontend already sends to Claude) and returns Anthropic-shaped
// responses, so zero frontend parsing logic changes are needed.
// ════════════════════════════════════════════════════════════

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

// Load and validate environment variables first — exits if GEMINI_API_KEY is missing
const config = require("./config/env");
const { createLogger, logger } = require("./middleware/logger");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");
const messagesRouter = require("./routes/messages");
const healthRouter = require("./routes/health");
const exportRouter = require("./routes/export");

const app = express();

// ── Security headers ─────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // allow browser fetches
  })
);

// ── CORS ─────────────────────────────────────────────────────
// In development, `corsOrigin` defaults to "*" so the APEX OS
// artifact (running in any Claude.ai tab) can reach the proxy.
// In production, set CORS_ORIGIN to your specific frontend URL.
const corsOptions = {
  origin: (origin, callback) => {
    const allowed = config.corsOrigin === "*" ? "*" : config.corsOrigin.split(",").map((s) => s.trim());
    if (allowed === "*") return callback(null, true);
    if (!origin || allowed.indexOf(origin) !== -1) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // pre-flight

// ── Body parsing ─────────────────────────────────────────────
// 10 MB limit to handle base64-encoded image uploads from the
// CEO chat file-attach feature.
app.use(express.json({ limit: "10mb" }));

// ── HTTP request logging ─────────────────────────────────────
app.use(createLogger());

// ── Rate limiting ─────────────────────────────────────────────
// Protects the Gemini API key from abuse. Defaults: 60 requests
// per minute per IP. Adjust via env vars in .env.
const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      type: "rate_limit",
      message: `Too many requests. Max ${config.rateLimitMaxRequests} per ${config.rateLimitWindowMs / 1000}s.`,
    },
  },
});
app.use("/v1", limiter);

// ── Routes ───────────────────────────────────────────────────
app.use("/health", healthRouter);
app.use("/v1/messages", messagesRouter);
app.use("/v1/export", exportRouter);

// ── 404 ──────────────────────────────────────────────────────
app.use(notFoundHandler);

// ── Error handler (must be last) ─────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────
const server = app.listen(config.port, () => {
  logger.info(`APEX Gemini Proxy running`, {
    port: config.port,
    env: config.nodeEnv,
    provider: config.aiProvider,
    model: config.geminiModel,
    cors: config.corsOrigin,
    rateLimitPerMin: config.rateLimitMaxRequests,
  });
  logger.info(`Proxy endpoint: http://localhost:${config.port}/v1/messages`);
  logger.info(`Health check:   http://localhost:${config.port}/health`);
});

// ── Graceful shutdown ─────────────────────────────────────────
function shutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully…`);
  server.close(() => {
    logger.info("Server closed.");
    process.exit(0);
  });
  setTimeout(() => {
    logger.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

module.exports = app; // exported for tests
