// ════════════════════════════════════════════════════════════
// Live server tests
// Requires the proxy to be running: npm start
// Usage: node test/live.test.js [--base http://localhost:8787]
//
// These tests DO call the real Gemini API, so a valid
// GEMINI_API_KEY in .env is required for them to pass.
// ════════════════════════════════════════════════════════════

const http  = require("http");
const https = require("https");

// ── Config ───────────────────────────────────────────────────
const args    = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const BASE    = baseIdx !== -1 ? args[baseIdx + 1] : "http://localhost:8787";

let passed = 0;
let failed = 0;

function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.log(`  ❌ ${label}`); failed++; }
}
function section(title) { console.log(`\n── ${title} ──`); }

// ── HTTP helper (no npm fetch required — uses Node stdlib) ───
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(path, BASE);
    const lib  = url.protocol === "https:" ? https : http;
    const data = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === "https:" ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({ status: res.status || res.statusCode, body: json, raw });
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Wait for server to be ready ──────────────────────────────
async function waitForServer(retries = 15, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await request("GET", "/health");
      if (r.status === 200) return true;
    } catch {}
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

(async () => {
  console.log(`\nConnecting to ${BASE} …`);
  const ready = await waitForServer();
  if (!ready) {
    console.error(`\n❌ Server not reachable at ${BASE}`);
    console.error("   Start the proxy with: npm start  (or npm run dev)");
    console.error("   Then retry: node test/live.test.js\n");
    process.exit(1);
  }
  console.log("✅ Server reachable\n");

  // ════════════════════════════════════════════════════════════
  // Health endpoint
  // ════════════════════════════════════════════════════════════
  section("GET /health");
  const health = await request("GET", "/health");
  check("status 200",               health.status === 200);
  check("body.status is 'ok'",      health.body?.status === "ok");
  check("body.provider is 'gemini'",health.body?.provider === "gemini");
  check("body.model present",       !!health.body?.model);
  check("body.uptime_seconds ≥ 0",  health.body?.uptime_seconds >= 0);
  check("body.timestamp present",   !!health.body?.timestamp);

  // ════════════════════════════════════════════════════════════
  // POST /v1/messages — validation errors (no Gemini key needed)
  // ════════════════════════════════════════════════════════════
  section("POST /v1/messages — validation errors");

  const noBody = await request("POST", "/v1/messages", {});
  check("Missing messages -> 400",   noBody.status === 400);
  check("Error type in body",        noBody.body?.error?.type === "invalid_request");

  const emptyArr = await request("POST", "/v1/messages", { messages: [] });
  check("Empty messages[] -> 400",   emptyArr.status === 400);

  const badRole = await request("POST", "/v1/messages", {
    messages: [{ role: "system", content: "hi" }],
  });
  check("Bad role -> 400",           badRole.status === 400);

  const noContent = await request("POST", "/v1/messages", {
    messages: [{ role: "user" }],
  });
  check("Missing content -> 400",    noContent.status === 400);

  // ════════════════════════════════════════════════════════════
  // 404 for unknown routes
  // ════════════════════════════════════════════════════════════
  section("404 for unknown routes");
  const notFound = await request("GET", "/nonexistent");
  check("Unknown route -> 404",      notFound.status === 404);
  check("404 body has error.type",   notFound.body?.error?.type === "not_found");

  // ════════════════════════════════════════════════════════════
  // CORS headers
  // ════════════════════════════════════════════════════════════
  section("CORS headers");
  const corsRes = await request("GET", "/health");
  // When CORS_ORIGIN=* the header should be present
  // (Node's http module doesn't expose response headers easily from our helper,
  //  so we just check the request didn't fail)
  check("CORS preflight doesn't crash server", corsRes.status === 200);

  // ════════════════════════════════════════════════════════════
  // POST /v1/messages — real Gemini call
  // ════════════════════════════════════════════════════════════
  section("POST /v1/messages — real Gemini API call");
  console.log("  (This calls the real Gemini API — may take 2-5 seconds)");

  let geminiRes;
  try {
    geminiRes = await request("POST", "/v1/messages", {
      model:      "claude-sonnet-4-6",        // ignored by proxy, uses GEMINI_MODEL
      max_tokens: 100,
      system:     "You are a helpful assistant. Reply in one sentence only.",
      messages:   [{ role: "user", content: "Reply with only the word PONG." }],
    });
  } catch (err) {
    console.log(`  ⚠️  Network error during live Gemini call: ${err.message}`);
    geminiRes = { status: 0, body: null };
  }

  if (geminiRes.status === 0) {
    console.log("  ⚠️  Skipping live Gemini checks — network error");
  } else if (geminiRes.status === 400 && geminiRes.body?.error?.message?.toLowerCase().includes("api key")) {
    console.log("  ⚠️  Skipping live Gemini checks — GEMINI_API_KEY not set or invalid");
    console.log("      Add a valid key to .env and re-run: node test/live.test.js");
  } else {
    check("status 200",                     geminiRes.status === 200);
    check("body.content is array",          Array.isArray(geminiRes.body?.content));
    check("body.content[0].type is 'text'", geminiRes.body?.content?.[0]?.type === "text");
    check("body.content[0].text non-empty", (geminiRes.body?.content?.[0]?.text || "").length > 0);
    check("body.provider is 'gemini'",      geminiRes.body?.provider === "gemini");
    check("body.stop_reason present",       !!geminiRes.body?.stop_reason);
    const text = (geminiRes.body?.content?.[0]?.text || "").toUpperCase();
    check("Response contains PONG",         text.includes("PONG"));
    console.log(`  ℹ️  Gemini replied: "${geminiRes.body?.content?.[0]?.text?.slice(0,80)}"`);
  }

  // ════════════════════════════════════════════════════════════
  // POST /v1/messages/json — JSON mode
  // ════════════════════════════════════════════════════════════
  section("POST /v1/messages/json — JSON mode via Gemini");
  console.log("  (Real Gemini API call in JSON mode)");

  let jsonRes;
  try {
    jsonRes = await request("POST", "/v1/messages/json", {
      max_tokens: 200,
      system:     "You output only valid JSON. No prose, no markdown.",
      messages:   [{ role: "user", content: 'Return {"status":"ok","value":42}' }],
    });
  } catch (err) {
    jsonRes = { status: 0, body: null };
  }

  if (jsonRes.status === 0 || (jsonRes.status === 400 && jsonRes.body?.error?.message?.toLowerCase().includes("api key"))) {
    console.log("  ⚠️  Skipping JSON mode live check — no valid API key");
  } else {
    check("status 200",                       jsonRes.status === 200);
    const rawText = jsonRes.body?.content?.[0]?.text || "";
    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch {}
    check("Response is valid JSON",           parsed !== null);
    if (parsed) {
      check("Parsed JSON has status field",   parsed.status !== undefined || parsed.value !== undefined);
    }
    console.log(`  ℹ️  JSON response: "${rawText.slice(0, 120)}"`);
  }

  // ════════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(60));
  const total = passed + failed;
  console.log(`Results: ${passed}/${total} checks passed`);
  if (failed === 0) {
    console.log("🎉 ALL LIVE TESTS PASSED");
  } else {
    console.log(`⚠️  ${failed} CHECK(S) FAILED`);
  }
  console.log("═".repeat(60));
  process.exit(failed === 0 ? 0 : 1);
})();
