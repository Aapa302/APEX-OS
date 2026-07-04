// ════════════════════════════════════════════════════════════
// Unit tests: geminiService translation logic
// Runs with: node test/geminiService.test.js
// No npm dependencies required.
// ════════════════════════════════════════════════════════════

// ── Inline the functions under test ──────────────────────────
// We extract only the pure translation functions and test them
// without spinning up Express or requiring env vars.

function toGeminiContents(messages) {
  return (messages || []).map((m) => {
    const role = m.role === "assistant" ? "model" : "user";
    const parts = [];
    if (typeof m.content === "string") {
      parts.push({ text: m.content });
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === "text") {
          parts.push({ text: block.text || "" });
        } else if (block.type === "image" && block.source) {
          parts.push({
            inlineData: {
              mimeType: block.source.media_type || "image/jpeg",
              data: block.source.data || "",
            },
          });
        }
      }
    } else if (m.content) {
      parts.push({ text: String(m.content) });
    }
    if (parts.length === 0) parts.push({ text: "" });
    return { role, parts };
  });
}

function toAnthropicResponse(geminiData) {
  const candidate = geminiData?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("");
  return { content: [{ type: "text", text }] };
}

// ── Minimal test harness ─────────────────────────────────────
let passed = 0;
let failed = 0;

function check(label, cond) {
  if (cond) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ════════════════════════════════════════════════════════════
// toGeminiContents
// ════════════════════════════════════════════════════════════
section("toGeminiContents: basic text messages");

const basic = toGeminiContents([
  { role: "user", content: "Hello Gemini" },
  { role: "assistant", content: "Hello! How can I help?" },
  { role: "user", content: "Tell me a joke" },
]);
check("Returns 3 items for 3 messages", basic.length === 3);
check("user role stays 'user'", basic[0].role === "user");
check("assistant role maps to 'model'", basic[1].role === "model");
check("String content becomes [{text}] part", basic[0].parts[0].text === "Hello Gemini");
check("Third message role is 'user'", basic[2].role === "user");

section("toGeminiContents: multipart (text + image) content block");

const multipart = toGeminiContents([
  {
    role: "user",
    content: [
      { type: "text", text: "What is in this image?" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "abc123==" } },
    ],
  },
]);
check("Returns 1 message", multipart.length === 1);
check("Role is 'user'", multipart[0].role === "user");
check("Has 2 parts", multipart[0].parts.length === 2);
check("First part is text", multipart[0].parts[0].text === "What is in this image?");
check("Second part is inlineData", !!multipart[0].parts[1].inlineData);
check("inlineData.mimeType correct", multipart[0].parts[1].inlineData.mimeType === "image/png");
check("inlineData.data correct", multipart[0].parts[1].inlineData.data === "abc123==");

section("toGeminiContents: edge cases");

const emptyContent = toGeminiContents([{ role: "user", content: "" }]);
check("Empty string content -> empty text part (not undefined)", emptyContent[0].parts[0].text === "");

const nullContent = toGeminiContents([{ role: "user", content: null }]);
check("Null content -> fallback empty text part", nullContent[0].parts[0].text === "");

const noMessages = toGeminiContents([]);
check("Empty messages array -> empty result", noMessages.length === 0);

const arrayWithOnlyText = toGeminiContents([
  { role: "user", content: [{ type: "text", text: "just text" }] },
]);
check("Array with only text block works", arrayWithOnlyText[0].parts[0].text === "just text");

section("toGeminiContents: long conversation history (20 messages)");

const longConv = Array.from({ length: 20 }, (_, i) => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content: `Message number ${i + 1}`,
}));
const longResult = toGeminiContents(longConv);
check("All 20 messages preserved", longResult.length === 20);
check("Roles alternate correctly", longResult[0].role === "user" && longResult[1].role === "model");
check("Last message role correct", longResult[19].role === "model");
check("Content preserved correctly", longResult[5].parts[0].text === "Message number 6");

// ════════════════════════════════════════════════════════════
// toAnthropicResponse
// ════════════════════════════════════════════════════════════
section("toAnthropicResponse: normal Gemini response");

const normal = toAnthropicResponse({
  candidates: [
    { content: { parts: [{ text: "Here is the answer." }] }, finishReason: "STOP" },
  ],
});
check("Returns object with content array", Array.isArray(normal.content));
check("content[0].type is 'text'", normal.content[0].type === "text");
check("content[0].text has the response", normal.content[0].text === "Here is the answer.");

section("toAnthropicResponse: multi-part Gemini response");

const multiText = toAnthropicResponse({
  candidates: [
    { content: { parts: [{ text: "Part one. " }, { text: "Part two." }] } },
  ],
});
check("Multiple text parts are joined", multiText.content[0].text === "Part one. Part two.");

section("toAnthropicResponse: edge cases");

const empty = toAnthropicResponse({ candidates: [] });
check("No candidates -> empty text (not crash)", empty.content[0].text === "");

const nullData = toAnthropicResponse(null);
check("Null input -> empty text (not crash)", nullData.content[0].text === "");

const noParts = toAnthropicResponse({ candidates: [{ content: { parts: [] } }] });
check("Empty parts array -> empty text", noParts.content[0].text === "");

// ════════════════════════════════════════════════════════════
// Request body validation rules (ported from validate.js)
// ════════════════════════════════════════════════════════════
section("Validation: messages field rules");

function validateMessages(body) {
  const { messages } = body;
  if (!messages || !Array.isArray(messages)) return "messages must be array";
  if (messages.length === 0) return "messages must not be empty";
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m.role || !["user", "assistant"].includes(m.role)) return `messages[${i}].role invalid`;
    if (m.content === undefined || m.content === null) return `messages[${i}].content required`;
  }
  return null; // valid
}

check("Missing messages -> error", validateMessages({}) !== null);
check("messages not array -> error", validateMessages({ messages: "oops" }) !== null);
check("Empty messages array -> error", validateMessages({ messages: [] }) !== null);
check("Invalid role -> error", validateMessages({ messages: [{ role: "system", content: "x" }] }) !== null);
check("Missing content -> error", validateMessages({ messages: [{ role: "user" }] }) !== null);
check("Valid messages -> no error", validateMessages({ messages: [{ role: "user", content: "hi" }] }) === null);
check("Valid multi-turn -> no error", validateMessages({
  messages: [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello" },
    { role: "user", content: "How are you?" },
  ],
}) === null);

// ════════════════════════════════════════════════════════════
// Gemini request body structure validation
// ════════════════════════════════════════════════════════════
section("Gemini request body assembly");

function buildGeminiBody(messages, system, opts = {}) {
  const body = {
    contents: toGeminiContents(messages),
    generationConfig: {
      maxOutputTokens: opts.maxTokens || 1000,
      temperature: 0.7,
    },
  };
  if (system && system.trim()) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  if (opts.jsonMode) {
    body.generationConfig.response_mime_type = "application/json";
  }
  return body;
}

const withSystem = buildGeminiBody(
  [{ role: "user", content: "Hi" }],
  "You are a helpful CEO.",
  { maxTokens: 500 }
);
check("systemInstruction present when system provided", !!withSystem.systemInstruction);
check("systemInstruction.parts[0].text correct", withSystem.systemInstruction.parts[0].text === "You are a helpful CEO.");
check("maxOutputTokens set correctly", withSystem.generationConfig.maxOutputTokens === 500);
check("No response_mime_type in normal mode", !withSystem.generationConfig.response_mime_type);

const noSystem = buildGeminiBody([{ role: "user", content: "Hi" }], "", { maxTokens: 1000 });
check("No systemInstruction when system is empty string", !noSystem.systemInstruction);

const jsonMode = buildGeminiBody([{ role: "user", content: "Return JSON" }], "Be precise", { jsonMode: true });
check("response_mime_type set in JSON mode", jsonMode.generationConfig.response_mime_type === "application/json");

const whitespaceSystem = buildGeminiBody([{ role: "user", content: "Hi" }], "   ", {});
check("Whitespace-only system prompt omitted", !whitespaceSystem.systemInstruction);

// ════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(60));
const total = passed + failed;
console.log(`Results: ${passed}/${total} checks passed`);
if (failed === 0) {
  console.log("🎉 ALL UNIT TESTS PASSED");
} else {
  console.log(`⚠️  ${failed} TEST(S) FAILED`);
}
console.log("═".repeat(60));
process.exit(failed === 0 ? 0 : 1);
