/**
 * Simple test runner for APEX Gemini Proxy.
 * Does not require external test frameworks, uses Node.js built-in 'assert'.
 */

const assert = require("assert");

// Mocking config since geminiService requires it but we're testing translation logic
// MUST be set before requiring geminiService
process.env.GEMINI_API_KEY = "dummy_key";
process.env.AI_PROVIDER = "gemini";
process.env.NCBI_API_KEY = "dummy_key";

const { toGeminiContents, toAnthropicResponse } = require("../src/services/geminiService");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

    // 2.5. Test generateContent with system prompt (verifying no systemInstruction payload and proper prepending)
    console.log("Testing: generateContent system prompt handling...");
    const originalFetch = global.fetch;
    let lastRequestBody = null;
    let lastRequestUrl = null;

    global.fetch = async (url, options) => {
      lastRequestUrl = url;
      lastRequestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          candidates: [{
            content: {
              parts: [{ text: "Mock response" }]
            },
            finishReason: "STOP"
          }]
        })
      };
    };

    try {
      const { generateContent } = require("../src/services/geminiService");
      const messages = [{ role: "user", content: "Hello CEO" }];
      const system = "You are the CEO of APEX.";

      const result = await generateContent(messages, system, { maxTokens: 100 });

      assert.strictEqual(result.content[0].text, "Mock response");
      assert.ok(lastRequestBody !== null, "Request body should not be null");
      assert.strictEqual(lastRequestBody.systemInstruction, undefined, "systemInstruction should not be in request payload");

      const firstMessage = lastRequestBody.contents[0];
      assert.strictEqual(firstMessage.role, "user");
      assert.strictEqual(firstMessage.parts[0].text, "You are the CEO of APEX.\n\nHello CEO");

      console.log("✅ Passed: generateContent system prompt prepended successfully without systemInstruction field\n");
    } finally {
      global.fetch = originalFetch;
    }

    // 3. Test GeminiError details
    console.log("Testing: GeminiError status and details...");
    const { GeminiError } = require("../src/services/geminiService");
    const err = new GeminiError("Test error", 429, { reason: "rate_limit" });
    assert.strictEqual(err.status, 429);
    assert.strictEqual(err.details.reason, "rate_limit");
    console.log("✅ Passed: GeminiError validation\n");

    // 3.5 Test NCBI API Key fallback logic
    console.log("Testing: NCBI API Key fallback logic...");
    const originalNCBIKey = process.env.NCBI_API_KEY;
    const originalViteKey = process.env.VITE_NCBI_API_KEY;

    try {
      // Scenario A: Both set -> should pick NCBI_API_KEY
      process.env.NCBI_API_KEY = "primary_key";
      process.env.VITE_NCBI_API_KEY = "fallback_key";
      delete require.cache[require.resolve("../src/config/env")];
      let config = require("../src/config/env");
      assert.strictEqual(config.ncbiApiKey, "primary_key");

      // Scenario B: Only VITE_NCBI_API_KEY set -> should pick VITE_NCBI_API_KEY
      delete process.env.NCBI_API_KEY;
      process.env.VITE_NCBI_API_KEY = "fallback_key";
      delete require.cache[require.resolve("../src/config/env")];
      config = require("../src/config/env");
      assert.strictEqual(config.ncbiApiKey, "fallback_key");

      // Scenario C: Neither set -> should be null
      delete process.env.NCBI_API_KEY;
      delete process.env.VITE_NCBI_API_KEY;
      delete require.cache[require.resolve("../src/config/env")];
      config = require("../src/config/env");
      assert.strictEqual(config.ncbiApiKey, null);
    } finally {
      process.env.NCBI_API_KEY = originalNCBIKey;
      process.env.VITE_NCBI_API_KEY = originalViteKey;
      delete require.cache[require.resolve("../src/config/env")];
    }
    console.log("✅ Passed: NCBI API Key fallback logic\n");

    // 4. Test NCBI Service directly
    console.log("Testing: NCBI Service methods directly...");
    const ncbiService = require("../src/services/NCBIService");

    console.log("  - searchGene('BRCA1')");
    const searchRes = await ncbiService.searchGene("BRCA1");
    assert.ok(searchRes.count > 0, "Gene search count should be > 0");
    assert.ok(searchRes.ids.length > 0, "Gene search ids should not be empty");
    assert.ok(searchRes.results.length > 0, "Gene search results should not be empty");

    await sleep(1500);

    console.log("  - searchPubmed('BRCA1 breast cancer')");
    const pubmedRes = await ncbiService.searchPubmed("BRCA1 breast cancer");
    assert.ok(pubmedRes.count > 0, "PubMed search count should be > 0");
    assert.ok(pubmedRes.ids.length > 0, "PubMed search ids should not be empty");

    await sleep(1500);

    console.log("  - fetchFasta('NM_007294.4')");
    const fastaRes = await ncbiService.fetchFasta("NM_007294.4");
    assert.strictEqual(fastaRes.accessionId, "NM_007294.4");
    assert.ok(fastaRes.fasta.includes(">NM_007294.4"), "FASTA content should include header");

    await sleep(1500);

    console.log("  - fetchMetadata('NM_007294.4')");
    const metaRes = await ncbiService.fetchMetadata("NM_007294.4");
    assert.strictEqual(metaRes.accessionId, "NM_007294.4");
    assert.ok(metaRes.metadata.title.includes("BRCA1"), "Metadata title should include BRCA1");

    console.log("✅ Passed: NCBI Service direct methods\n");

    // 5. Test NCBI Express Routes
    console.log("Testing: NCBI Express Routes integration...");
    // Require the server (this starts the Express app on config.port, e.g. 8787)
    require("../src/server");
    const PORT = process.env.PORT || 8787;
    const BASE_ROUTE_URL = `http://localhost:${PORT}/api/ncbi`;

    await sleep(1500);

    console.log(`  - POST /api/ncbi/search-gene`);
    const routeSearchRes = await fetch(`${BASE_ROUTE_URL}/search-gene`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "BRCA1" })
    });
    assert.strictEqual(routeSearchRes.status, 200, "Search gene route should return 200");
    const routeSearchData = await routeSearchRes.json();
    assert.ok(routeSearchData.count > 0, "Route search count should be > 0");
    assert.ok(routeSearchData.ids.length > 0, "Route search ids should not be empty");

    await sleep(1500);

    console.log(`  - POST /api/ncbi/fetch-fasta`);
    const routeFastaRes = await fetch(`${BASE_ROUTE_URL}/fetch-fasta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessionId: "NM_007294.4" })
    });
    assert.strictEqual(routeFastaRes.status, 200, "Fetch FASTA route should return 200");
    const routeFastaData = await routeFastaRes.json();
    assert.strictEqual(routeFastaData.accessionId, "NM_007294.4");
    assert.ok(routeFastaData.fasta.includes(">NM_007294.4"), "Route FASTA content should include header");

    await sleep(1500);

    console.log(`  - POST /api/ncbi/search-pubmed`);
    const routePubmedRes = await fetch(`${BASE_ROUTE_URL}/search-pubmed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "BRCA1" })
    });
    assert.strictEqual(routePubmedRes.status, 200, "Search PubMed route should return 200");
    const routePubmedData = await routePubmedRes.json();
    assert.ok(routePubmedData.count > 0, "Route PubMed count should be > 0");
    assert.ok(routePubmedData.ids.length > 0, "Route PubMed ids should not be empty");

    console.log("✅ Passed: NCBI Express Routes integration\n");

    console.log("🎉 All tests passed!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Test failed!");
    console.error(err);
    process.exit(1);
  }
}

// Only run tests if this file is executed directly
if (require.main === module) {
  runTests();
}
