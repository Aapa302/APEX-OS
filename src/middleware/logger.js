// ════════════════════════════════════════════════════════════
// Logger Middleware
// Lightweight structured logger for development and production.
// In production, replace with a proper logger like pino or winston.
// ════════════════════════════════════════════════════════════

const morgan = require("morgan");

// Custom Morgan format: timestamp method path status response-time
const DEV_FORMAT = ':date[iso] :method :url :status :response-time ms';
const PROD_FORMAT = ':remote-addr - :date[iso] ":method :url HTTP/:http-version" :status :res[content-length] :response-time ms - origin: :req[origin] - ua: :user-agent';

function createLogger() {
  const format = process.env.NODE_ENV === "production" ? PROD_FORMAT : DEV_FORMAT;
  return morgan(format);
}

// Simple structured log helper used in application code (not Express middleware)
function log(level, message, data) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(data !== undefined ? { data } : {}),
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

const logger = {
  info: (msg, data) => log("info", msg, data),
  warn: (msg, data) => log("warn", msg, data),
  error: (msg, data) => log("error", msg, data),
};

module.exports = { createLogger, logger };
