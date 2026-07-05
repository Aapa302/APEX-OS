// ════════════════════════════════════════════════════════════
// Error Handler Middleware
// Centralised error handler — always returns JSON so the frontend
// can reliably parse error responses.
// ════════════════════════════════════════════════════════════

const { GeminiError } = require("../services/geminiService");

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV !== "production";

  if (err instanceof GeminiError) {
    const status = err.status || 502;
    console.error(`[GeminiError] ${status} ${err.message}`, isDev && err.details ? err.details : "");
    return res.status(status).json({
      error: {
        type: "gemini_error",
        message: err.message,
        ...(isDev && err.details ? { details: err.details } : {}),
      },
    });
  }

  // Rate limit errors from express-rate-limit (they call next(err) in newer versions)
  if (err.statusCode === 429 || err.status === 429) {
    return res.status(429).json({
      error: { type: "rate_limit", message: "Too many requests. Please slow down." },
    });
  }

  // JSON body parse errors from express.json()
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      error: { type: "invalid_json", message: "Request body is not valid JSON." },
    });
  }

  // Unexpected / unhandled errors
  console.error("[UnhandledError]", err);
  return res.status(500).json({
    error: {
      type: "internal_error",
      message: "An unexpected error occurred.",
      ...(isDev ? { stack: err.stack } : {}),
    },
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      type: "not_found",
      message: `Route ${req.method} ${req.path} not found.`,
      hint: "The only endpoint is POST /v1/messages",
    },
  });
}

module.exports = { errorHandler, notFoundHandler };
