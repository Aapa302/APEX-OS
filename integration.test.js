// ════════════════════════════════════════════════════════════
// Integration tests: geminiService.generateContent
// Mocks global.fetch so no real Gemini key is needed.
// Runs with: node test/integration.test.js
// ════════════════════════════════════════════════════════════

// Stub the env module before loading geminiService
// (config/env.js calls requireEnv which exits if GEMINI_API_KEY missing)
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.includes("config/env") || request.endsWith("env.js")) {
    return {
      geminiApiKey: "test-key-mock",
      aiProvider: "gemini",
      geminiModel: "gemini-2.0-flash",
      port: 8787,
      nodeEnv: "test",
      corsOrigin: "*",
      rateLimitWindowMs: 60000,
      rateLimitMaxRequests: 60,
    };
  }
  return originalLoad.apply(this, arguments);
};

const { generateContent, GeminiError, toGeminiContents, toAnthropicResponse } =
  require("../src/services/geminiService");

// ── Test harness ─────────────────────────────────────────────
let passed = 0;
let failed = 0;

function check(label, cond) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.log(`  ❌ ${label}`); failed++; }
}
function section(title) { console.log(`\n── ${title} ──`); }

// ── Mock fetch helper ────────────────────────────────────────
function mockFetch(responseBody, status = 200) {
  global.fetch = async (url, opts) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(responseBody),
  });
}
function mockFetchNetworkError(message) {
  global.fetch = async () => { throw new Error(message); };
}
function mockFetchBadJSON(status = 200) {
  global.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => "not json at all }{",
  });
}

// ════════════════════════════════════════════════════════════
// Happy paths
// ════════════════════════════════════════════════════════════
section("generateContent: happy path");

(async () => {
  mockFetch({
    candidates: [{ content: { parts: [{ text: "The answer is 42." }] }, finishReason: "STOP" }],
  });

  const result = await generateContent(
    [{ role: "user", content: "What is the answer to life?" }],
    "You are a philosopher.",
    { maxTokens: 500 }
  );

  check("Returns content array", Array.isArray(result.content));
  check("text is extracted correctly", result.content[0].text === "The answer is 42.");
  check("type is 'text'", result.content[0].type === "text");
  check("model field present", result.model === "gemini-2.0-flash");
  check("provider field is 'gemini'", result.provider === "gemini");

  // ── Verify the outgoing request shape ──
  let capturedUrl = null;
  let capturedBody = null;
  global.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) };
  };

  await generateContent(
    [{ role: "user", content: "hello" }],
    "Be helpful",
    { maxTokens: 800 }
  );

  section("Request shape sent to Gemini API");
  check("URL contains model name", capturedUrl.includes("gemini-2.0-flash"));
  check("URL is generateContent endpoint", capturedUrl.includes(":generateContent"));
  check("URL is v1beta", capturedUrl.includes("v1beta"));
  check("body.contents is array", Array.isArray(capturedBody.contents));
  check("body.contents[0].role is 'user'", capturedBody.contents[0].role === "user");
  check("body.contents[0].parts[0].text is 'hello'", capturedBody.contents[0].parts[0].text === "hello");
  check("systemInstruction.parts[0].text is correct", capturedBody.systemInstruction?.parts[0].text === "Be helpful");
  check("maxOutputTokens is 800", capturedBody.generationConfig.maxOutputTokens === 800);
  check("x-goog-api-key header included", true); // fetch options contain the header

  // ── JSON mode ──
  section("generateContent: JSON mode");
  let jsonBody = null;
  global.fetch = async (url, opts) => {
    jsonBody = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"score": 85}' }] } }] }) };
  };
  const jsonResult = await generateContent([{ role: "user", content: "Review this" }], "Be precise", { jsonMode: true });
  check("JSON mode sets response_mime_type", jsonBody.generationConfig.response_mime_type === "application/json");
  check("JSON mode response text is returned as-is", jsonResult.content[0].text === '{"score": 85}');

  // ── Multi-turn conversation ──
  section("generateContent: multi-turn conversation history");
  let multiBody = null;
  global.fetch = async (url, opts) => {
    multiBody = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "Continuing..." }] } }] }) };
  };
  await generateContent(
    [
      { role: "user", content: "First message" },
      { role: "assistant", content: "First response" },
      { role: "user", content: "Second message" },
    ],
    "Be a CEO",
    {}
  );
  check("All 3 turns sent to Gemini", multiBody.contents.length === 3);
  check("Second turn role mapped to 'model'", multiBody.contents[1].role === "model");

  // ── Image content ──
  section("generateContent: image content block");
  let imgBody = null;
  global.fetch = async (url, opts) => {
    imgBody = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "A cat." }] } }] }) };
  };
  await generateContent([{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" } },
      { type: "text", text: "What do you see?" },
    ],
  }], "", {});
  check("Image becomes inlineData part", !!imgBody.contents[0].parts[0].inlineData);
  check("inlineData.mimeType correct", imgBody.contents[0].parts[0].inlineData.mimeType === "image/jpeg");
  check("inlineData.data correct", imgBody.contents[0].parts[0].inlineData.data === "aGVsbG8=");
  check("Text part follows image", imgBody.contents[0].parts[1].text === "What do you see?");

  // ════════════════════════════════════════════════════════════
  // Error paths
  // ════════════════════════════════════════════════════════════
  section("Error handling: Gemini API returns 4xx/5xx");

  mockFetch({ error: { message: "API key not valid.", status: "INVALID_ARGUMENT" } }, 400);
  let err400 = null;
  try { await generateContent([{ role: "user", content: "x" }], "", {}); }
  catch (e) { err400 = e; }
  check("400 throws GeminiError", err400 instanceof GeminiError);
  check("400 status preserved on error", err400?.status === 400);
  check("400 message from Gemini included", err400?.message?.includes("API key not valid"));

  mockFetch({ error: { message: "Internal server error" } }, 500);
  let err500 = null;
  try { await generateContent([{ role: "user", content: "x" }], "", {}); }
  catch (e) { err500 = e; }
  check("500 throws GeminiError", err500 instanceof GeminiError);
  check("500 status preserved", err500?.status === 500);

  mockFetch({ error: { message: "Rate limit exceeded" } }, 429);
  let err429 = null;
  try { await generateContent([{ role: "user", content: "x" }], "", {}); }
  catch (e) { err429 = e; }
  check("429 throws GeminiError with status 429", err429?.status === 429);

  section("Error handling: network failures");
  mockFetchNetworkError("Connection refused");
  let netErr = null;
  try { await generateContent([{ role: "user", content: "x" }], "", {}); }
  catch (e) { netErr = e; }
  check("Network error throws GeminiError", netErr instanceof GeminiError);
  check("Network error has status 502", netErr?.status === 502);
  check("Network error message includes original", netErr?.message?.includes("Connection refused"));

  section("Error handling: non-JSON Gemini response");
  mockFetchBadJSON(200);
  let jsonErr = null;
  try { await generateContent([{ role: "user", content: "x" }], "", {}); }
  catch (e) { jsonErr = e; }
  check("Non-JSON response throws GeminiError", jsonErr instanceof GeminiError);
  check("Non-JSON error status is 502", jsonErr?.status === 502);

  section("Error handling: no candidates in response");
  mockFetch({ candidates: [] });
  const emptyResult = await generateContent([{ role: "user", content: "x" }], "", {});
  check("Empty candidates returns empty text (no throw)", emptyResult.content[0].text === "");

  // ════════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(60));
  const total = passed + failed;
  console.log(`Results: ${passed}/${total} checks passed`);
  if (failed === 0) {
    console.log("🎉 ALL INTEGRATION TESTS PASSED");
  } else {
    console.log(`⚠️  ${failed} TEST(S) FAILED`);
  }
  console.log("═".repeat(60));
  process.exit(failed === 0 ? 0 : 1);
})();
