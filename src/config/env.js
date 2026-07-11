// ════════════════════════════════════════════════════════════
// Environment configuration — single source of truth.
// Loaded once at startup. Fails loudly if required vars are missing
// so the server never silently runs with a broken Gemini connection.
// ════════════════════════════════════════════════════════════

require("dotenv").config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    // eslint-disable-next-line no-console
    console.error(`\n❌ Missing required environment variable: ${name}`);
    console.error(`   Copy .env.example to .env and fill it in.\n`);
    process.exit(1);
  }
  return value.trim();
}

const config = {
  geminiApiKey: requireEnv("GEMINI_API_KEY"),
  aiProvider: (process.env.AI_PROVIDER || "gemini").trim(),
  geminiModel: (process.env.GEMINI_MODEL || "gemini-flash-latest").trim(),
  port: parseInt(process.env.PORT || "8787", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "120", 10),
};

if (config.aiProvider !== "gemini") {
  console.error(`\n❌ AI_PROVIDER="${config.aiProvider}" is not supported by this proxy. Only "gemini" is implemented.\n`);
  process.exit(1);
}

module.exports = config;
