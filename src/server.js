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
const ncbiRouter = require("./routes/ncbi");
const dnaRouter = require("./routes/dna");
const architectureRouter = require("./routes/architecture");
const companyRouter = require("./routes/company");
const tasksRouter = require("./routes/tasks");
const dnaHealthCheckRouter = require("./routes/dnaHealthCheck");
const dnaHealthAutoScanRouter = require("./routes/dnaHealthAutoScan");
const dnaSearchRouter = require("./routes/dnaSearch");
const saveSimulationRouter = require("./routes/saveSimulation");
const researchNotesRouter = require("./routes/researchNotes");
const hypothesesRouter = require("./routes/hypotheses");
const experimentsRouter = require("./routes/experiments");
const debugRouter = require("./routes/debug");
const ceoChatRouter = require("./routes/ceoChat");
const { resolveModel } = require("./services/GeminiModelResolver");

const app = express();

// Required for express-rate-limit to work correctly behind Render/Cloudflare
app.set('trust proxy', 1);

// ── Minimal diagnostic endpoint ──────────────────────────────
app.get("/ping", (req, res) => res.send("pong"));

// ── Security headers (Disabled for maximum compatibility in sandbox) ──
// app.use(helmet());

// ── CORS ─────────────────────────────────────────────────────
const corsOptions = {
  origin: (origin, callback) => {
    // Totally permissive for sandbox compatibility
    callback(null, true);
  },
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  credentials: true,
  maxAge: 86400,
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
app.use("/api/ncbi", ncbiRouter);
app.use("/api/dna", dnaRouter);
app.use("/api/architecture", architectureRouter);
app.use("/api/company", companyRouter);
app.use("/tasks", tasksRouter);
app.use("/dna-health-check", dnaHealthCheckRouter);
app.use("/api/dna-health", dnaHealthAutoScanRouter);
app.use("/api/search-dna", dnaSearchRouter);
app.use("/api/save-simulation", saveSimulationRouter);
app.use("/api/research-notes", researchNotesRouter);
app.use("/api/hypotheses", hypothesesRouter);
app.use("/api/experiments", experimentsRouter);
app.use("/api/debug", debugRouter);
app.use("/api/ceo-chat", ceoChatRouter);

app.get("/autonomous-log", async (req, res, next) => {
  try {
    const fs = require("fs").promises;
    const path = require("path");
    const logPath = path.join(__dirname, "../ceo-autonomous-log.json");
    let logs = [];
    try {
      const data = await fs.readFile(logPath, "utf8");
      logs = JSON.parse(data);
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error("Error reading autonomous log:", err.message);
      }
    }
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

// POST /autonomous-trigger — manually triggers the autonomous CEO check
app.post("/autonomous-trigger", async (req, res, next) => {
  try {
    const { runAutonomousCEOCheck } = require("./services/ceoAutonomousService");
    // Trigger check in background
    runAutonomousCEOCheck()
      .then(() => console.log("[Autonomous CEO] Manual trigger completed."))
      .catch(err => console.error("[Autonomous CEO] Manual trigger failed:", err));

    res.json({
      success: true,
      message: "Autonomous CEO check triggered successfully in the background. Check logs via GET /autonomous-log soon."
    });
  } catch (error) {
    next(error);
  }
});

// ── 404 ──────────────────────────────────────────────────────
app.use(notFoundHandler);

// ── Error handler (must be last) ─────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────
let server;

(async () => {
  try {
    await resolveModel();
  } catch (initErr) {
    console.error("Critical: Failed to initialize Gemini model on startup:", initErr.message);
  }

  server = app.listen(config.port, () => {
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

    // Warn if NCBI API Key is missing
    if (!config.ncbiApiKey) {
      logger.warn(`⚠️ Warning: NCBI API Key is not set. Routes under /api/ncbi/ will return errors until NCBI_API_KEY or VITE_NCBI_API_KEY is provided.`);
    } else {
      const keySource = process.env.NCBI_API_KEY ? "NCBI_API_KEY" : "VITE_NCBI_API_KEY";
      logger.info(`NCBI Biological Data Service active (${keySource} is configured)`);
    }

    // Start autonomous CEO check scheduler
    const { runAutonomousCEOCheck } = require("./services/ceoAutonomousService");
    setTimeout(() => {
      runAutonomousCEOCheck().catch(err => console.error("Error in initial Autonomous CEO Check:", err));
    }, 5000); // 5 seconds initial delay
    setInterval(runAutonomousCEOCheck, 45 * 60 * 1000); // every 45 minutes
  });
})();

// ── Graceful shutdown ─────────────────────────────────────────
function shutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully…`);
  if (server) {
    server.close(() => {
      logger.info("Server closed.");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
  setTimeout(() => {
    logger.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

module.exports = app; // exported for tests
