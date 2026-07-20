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
const multer = require("multer");

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
const simulationsRouter = require("./routes/simulations");
const teamChatRouter = require("./routes/teamChat");
const researchReportsRouter = require("./routes/researchReports");
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

// ── DNA-Encoder-v1 Endpoints ────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 } // 500KB limit
});

app.post("/dna-encode", (req, res, next) => {
  try {
    const text = req.body.text || req.body.data;
    if (text === undefined) {
      return res.status(400).json({ error: "Required parameter 'text' or 'data' is missing." });
    }
    const encoderV1 = require("./services/DNAEncoderV1Service");
    const dna = encoderV1.encode(text);
    res.json({ success: true, dna, text });
  } catch (error) {
    next(error);
  }
});

app.post("/dna-synthesize", (req, res, next) => {
  try {
    const inputSeq = req.body.sequence || req.body.dna;
    const name = req.body.name || req.body.sequenceName || `APEX_SEQ_${Date.now()}`;

    if (!inputSeq || typeof inputSeq !== "string") {
      return res.status(400).json({ error: "Required parameter 'sequence' or 'dna' is missing or not a string." });
    }

    const rawSeq = inputSeq.replace(/\s/g, "").toUpperCase();
    if (rawSeq.length === 0) {
      return res.status(400).json({ error: "DNA sequence cannot be empty." });
    }

    if (/[^ACGT]/.test(rawSeq)) {
      return res.status(400).json({ error: "DNA sequence contains invalid characters. Only A, C, G, T are allowed." });
    }

    // GC Content %
    const gcCount = (rawSeq.match(/[GC]/g) || []).length;
    const gcPercent = ((gcCount / rawSeq.length) * 100).toFixed(2);

    // Homopolymer check status (runs of 4 or more identical consecutive nucleotides)
    const hasHomopolymer = /([ACGT])\1\1\1/.test(rawSeq);
    const homopolymerStatus = hasHomopolymer ? "FAIL" : "PASS";

    // Split into chunks if sequence > 200bp
    const chunks = [];
    const chunkSize = 200;
    if (rawSeq.length <= chunkSize) {
      chunks.push({
        header: name,
        seq: rawSeq
      });
    } else {
      for (let i = 0, chunkIdx = 1; i < rawSeq.length; i += chunkSize, chunkIdx++) {
        chunks.push({
          header: `${name}_chunk_${chunkIdx}`,
          seq: rawSeq.slice(i, i + chunkSize)
        });
      }
    }

    // Wrap sequence to 60-70 characters per line (using 60 as standard)
    const wrapSequence = (seq, length = 60) => {
      const lines = [];
      for (let i = 0; i < seq.length; i += length) {
        lines.push(seq.slice(i, i + length));
      }
      return lines.join("\n");
    };

    // Format FASTA content
    let fastaLines = [];
    fastaLines.push(`; APEX DNA Synthesizer Export`);
    fastaLines.push(`; Sequence Length: ${rawSeq.length} bp`);
    fastaLines.push(`; GC Content: ${gcPercent}%`);
    fastaLines.push(`; Homopolymer Check: ${homopolymerStatus}`);

    for (const chunk of chunks) {
      fastaLines.push(`>${chunk.header}`);
      fastaLines.push(wrapSequence(chunk.seq, 60));
    }

    const fastaContent = fastaLines.join("\n") + "\n";

    const safeFileName = name.replace(/[^a-z0-9-_]/gi, "_") || "dna_sequence";
    res.set({
      "Content-Type": "text/plain",
      "Content-Disposition": `attachment; filename="${safeFileName}.fasta"`,
      "Content-Length": Buffer.byteLength(fastaContent)
    });

    res.send(fastaContent);
  } catch (error) {
    next(error);
  }
});

app.post("/dna-decode", (req, res, next) => {
  try {
    const dna = req.body.dna || req.body.sequence;
    if (dna === undefined) {
      return res.status(400).json({ error: "Required parameter 'dna' or 'sequence' is missing." });
    }
    const encoderV1 = require("./services/DNAEncoderV1Service");
    const text = encoderV1.decode(dna);
    res.json({ success: true, text, dna });
  } catch (error) {
    next(error);
  }
});

// ── Routes ───────────────────────────────────────────────────
app.use("/health", healthRouter);
app.use("/v1/messages", messagesRouter);
app.use("/v1/export", exportRouter);
app.use("/api/ncbi", ncbiRouter);
app.use("/api/dna", dnaRouter);
app.use("/api/architecture", architectureRouter);
app.use("/api/company", companyRouter);
app.use("/tasks", tasksRouter);
app.use("/simulations", simulationsRouter);
app.use("/team-chat", teamChatRouter);
app.use("/research-reports", researchReportsRouter);

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
