/**
 * Simple test runner for APEX Gemini Proxy.
 * Does not require external test frameworks, uses Node.js built-in 'assert'.
 */

const assert = require("assert");
const { toGeminiContents, toAnthropicResponse } = require("../src/services/geminiService");

async function runTests() {
  console.log("🚀 Running APEX Gemini Proxy tests...\n");

  try {
    // 1. Test Anthropic to Gemini Content Translation
    console.log("Testing: Anthropic -> Gemini message translation...");
    const anthropicMessages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
      { role: "user", content: [{ type: "text", text: "Explain this image" }, { type: "image", source: { media_type: "image/jpeg", data: "base64data" } }] }
    ];

    const geminiContents = toGeminiContents(anthropicMessages);

    assert.strictEqual(geminiContents.length, 3);
    assert.strictEqual(geminiContents[0].role, "user");
    assert.strictEqual(geminiContents[0].parts[0].text, "Hello");
    assert.strictEqual(geminiContents[1].role, "model");
    assert.strictEqual(geminiContents[1].parts[0].text, "Hi there!");
    assert.strictEqual(geminiContents[2].role, "user");
    assert.strictEqual(geminiContents[2].parts[0].text, "Explain this image");
    assert.strictEqual(geminiContents[2].parts[1].inlineData.mimeType, "image/jpeg");
    assert.strictEqual(geminiContents[2].parts[1].inlineData.data, "base64data");
    console.log("✅ Passed: Anthropic -> Gemini message translation\n");

    // 2. Test Gemini to Anthropic Response Translation
    console.log("Testing: Gemini -> Anthropic response translation...");
    const geminiResponse = {
      candidates: [{
        content: {
          parts: [{ text: "This is a response from Gemini." }]
        },
        finishReason: "STOP"
      }]
    };

    const anthropicResponse = toAnthropicResponse(geminiResponse);

    assert.strictEqual(anthropicResponse.provider, "gemini");
    assert.strictEqual(anthropicResponse.content[0].type, "text");
    assert.strictEqual(anthropicResponse.content[0].text, "This is a response from Gemini.");
    console.log("✅ Passed: Gemini -> Anthropic response translation\n");

    // 3. Test GeminiError details
    console.log("Testing: GeminiError status and details...");
    const { GeminiError } = require("../src/services/geminiService");
    const err = new GeminiError("Test error", 429, { reason: "rate_limit" });
    assert.strictEqual(err.status, 429);
    assert.strictEqual(err.details.reason, "rate_limit");
    console.log("✅ Passed: GeminiError validation\n");

    console.log("🎉 All tests passed!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Test failed!");
    console.error(err);
    process.exit(1);
  }
}

// Mocking config since geminiService requires it but we're testing translation logic
// We set a dummy API key in env so requireEnv doesn't fail if we were to load config
process.env.GEMINI_API_KEY = "dummy_key";

// Also mock other env vars if needed
process.env.AI_PROVIDER = "gemini";

runTests();
