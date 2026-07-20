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

  const fs = require("fs").promises;
  const path = require("path");

  // Reset dna-health-logs.json and simulations.json for deterministic testing
  try {
    await fs.writeFile(path.join(__dirname, "../dna-health-logs.json"), "[]");

    const initialSimulations = [
      {
        "id": "sim_1",
        "name": "BRCA1 Gene Segment Alpha",
        "sequence": "ACGTACGTACGTACGT",
        "checksum": "cf573e65038d08ff910a3345642ffd1e8329844633c2dcb15964b324ebdba4d0",
        "triplicates": [
          "ACGTACGTACGTACGT",
          "ACGTACGTACGTACGT",
          "ACGTACGTACGTACGT"
        ],
        "original": "APEX-OS Block 1",
        "strategy": "base4"
      },
      {
        "id": "sim_2",
        "name": "BRCA1 Gene Segment Beta (Corrupted)",
        "sequence": "ACGTACGTACGGACGT",
        "checksum": "cf573e65038d08ff910a3345642ffd1e8329844633c2dcb15964b324ebdba4d0",
        "triplicates": [
          "ACGTACGTACGTACGT",
          "ACGTACGTACGTACGT",
          "ACGTACGTACGGACGT"
        ],
        "original": "APEX-OS Block 2",
        "strategy": "base4"
      },
      {
        "id": "sim_3",
        "name": "BRCA1 Gene Segment Gamma (Corrupted)",
        "sequence": "ACGTGCGTACGTACGT",
        "checksum": "cf573e65038d08ff910a3345642ffd1e8329844633c2dcb15964b324ebdba4d0",
        "triplicates": [
          "ACGTACGTACGTACGT",
          "ACGTGCGTACGTACGT",
          "ACGTACGTACGTACGT"
        ],
        "original": "APEX-OS Block 3",
        "strategy": "base4"
      }
    ];
    await fs.writeFile(path.join(__dirname, "../simulations.json"), JSON.stringify(initialSimulations, null, 2));
  } catch (err) {
    console.warn("Failed to reset simulations/logs files:", err.message);
  }

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

    // ── 6. Test DNA Storage Engineer Service ───────────────────
    console.log("Testing: DNA Engineer Service direct methods...");
    const dnaService = require("../src/services/DNAEngineerService");
    const testPayload = "APEX-OS Digital Payload Block with Reed-Solomon Parity!";

    // Test each strategy for encoding & decoding bit-perfection
    const strategies = ["base4", "huffman", "reed-solomon", "homopolymer-safe"];
    for (const strat of strategies) {
      console.log(`  - Strategy: '${strat}' encode/decode...`);
      const enc = dnaService.encode(testPayload, strat);
      assert.strictEqual(enc.success, true);
      assert.ok(enc.sequence.length > 0, "Sequence should not be empty");
      assert.ok(enc.fasta.startsWith(">"), "FASTA should start with header");

      const dec = dnaService.decode(enc.fasta);
      assert.strictEqual(dec.success, true);
      assert.strictEqual(dec.decoded, testPayload, `Decoded text should exactly match original for ${strat}`);
      assert.strictEqual(dec.match, true, "SHA-256 hash integrity should validate");
    }

    console.log("  - Huffman single character edge case...");
    const singleCharPayload = "AAAAAA";
    const huffEnc = dnaService.encode(singleCharPayload, "huffman");
    const huffDec = dnaService.decode(huffEnc.fasta);
    assert.strictEqual(huffDec.decoded, singleCharPayload, "Single character Huffman decode should exactly match original");

    // Test each strategy for encoding & decoding bit-perfection
    for (const strat of strategies) {
      console.log(`  - Strategy: '${strat}' encode/decode (repeat)...`);
      const enc = dnaService.encode(testPayload, strat);
      assert.strictEqual(enc.success, true);
      assert.ok(enc.sequence.length > 0, "Sequence should not be empty");
      assert.ok(enc.fasta.startsWith(">"), "FASTA should start with header");

      const dec = dnaService.decode(enc.fasta);
      assert.strictEqual(dec.success, true);
      assert.strictEqual(dec.decoded, testPayload, `Decoded text should exactly match original for ${strat}`);
      assert.strictEqual(dec.match, true, "SHA-256 hash integrity should validate");
    }

    // Test validation
    console.log("  - DNA Sequence Validation checks...");
    // Valid sequence
    const validSeq = "ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT";
    const valResult1 = dnaService.validate(validSeq);
    assert.strictEqual(valResult1.isValid, true);
    assert.strictEqual(valResult1.gcImbalance, false, "GC content should be balanced (50%)");
    assert.strictEqual(valResult1.homopolymerRuns.length, 0, "Should have no homopolymer runs");

    // Invalid character
    const invalidSeq = "ACGTACGTXACGT";
    const valResult2 = dnaService.validate(invalidSeq);
    assert.strictEqual(valResult2.isValid, false);
    assert.ok(valResult2.reason.includes("Illegal non-nucleotide character"), "Should report invalid character");

    // Homopolymer run
    const homopolymerSeq = "ACGTACGGGGGGACGT";
    const valResult3 = dnaService.validate(homopolymerSeq);
    assert.strictEqual(valResult3.isValid, true);
    assert.ok(valResult3.homopolymerRuns.length > 0, "Should detect homopolymer runs of 4+ same bases");
    assert.strictEqual(valResult3.homopolymerRuns[0].base, "G");
    assert.strictEqual(valResult3.homopolymerRuns[0].length, 6);

    // GC Imbalance
    const imbalancedSeq = "AAAAAAATTTTTT";
    const valResult4 = dnaService.validate(imbalancedSeq);
    assert.strictEqual(valResult4.isValid, true);
    assert.strictEqual(valResult4.gcImbalance, true, "Should detect GC imbalance (0% GC)");

    // Strategy comparison
    console.log("  - Strategy Comparative Analysis...");
    const compResult = dnaService.compare(testPayload);
    for (const strat of strategies) {
      assert.ok(compResult[strat], `Comparison should contain results for ${strat}`);
      assert.strictEqual(compResult[strat].success, true);
    }
    console.log("✅ Passed: DNA Engineer Service direct methods\n");

    // ── 7. Test DNA Express Routes Integration ─────────────────
    console.log("Testing: DNA Express Routes integration...");
    const BASE_DNA_ROUTE_URL = `http://localhost:${PORT}/api/dna`;

    console.log("  - POST /api/dna/encode (reed-solomon)");
    const rEncodeRes = await fetch(`${BASE_DNA_ROUTE_URL}/encode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: testPayload, strategy: "reed-solomon" })
    });
    assert.strictEqual(rEncodeRes.status, 200, "Encode route should return 200");
    const rEncodeData = await rEncodeRes.json();
    assert.strictEqual(rEncodeData.success, true);
    assert.strictEqual(rEncodeData.strategy, "reed-solomon");
    assert.ok(rEncodeData.fasta.includes(">APEX_DNA_BLOCK"), "Fasta block should contain custom header");

    console.log("  - POST /api/dna/decode");
    const rDecodeRes = await fetch(`${BASE_DNA_ROUTE_URL}/decode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence: rEncodeData.fasta })
    });
    assert.strictEqual(rDecodeRes.status, 200, "Decode route should return 200");
    const rDecodeData = await rDecodeRes.json();
    assert.strictEqual(rDecodeData.success, true);
    assert.strictEqual(rDecodeData.decoded, testPayload);
    assert.strictEqual(rDecodeData.match, true);

    console.log("  - POST /api/dna/validate");
    const rValidateRes = await fetch(`${BASE_DNA_ROUTE_URL}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence: rEncodeData.sequence })
    });
    assert.strictEqual(rValidateRes.status, 200, "Validate route should return 200");
    const rValidateData = await rValidateRes.json();
    assert.strictEqual(rValidateData.isValid, true);
    assert.ok(rValidateData.gcContent !== undefined);

    console.log("  - POST /api/dna/compare");
    const rCompareRes = await fetch(`${BASE_DNA_ROUTE_URL}/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: testPayload })
    });
    assert.strictEqual(rCompareRes.status, 200, "Compare route should return 200");
    const rCompareData = await rCompareRes.json();
    for (const strat of strategies) {
      assert.ok(rCompareData[strat]);
      assert.strictEqual(rCompareData[strat].success, true);
    }
    console.log("✅ Passed: DNA Express Routes integration\n");

    // ── 8. Test Storage Architect Service ──────────────────────
    console.log("Testing: Storage Architect Service direct methods...");
    const architectService = require("../src/services/StorageArchitectService");
    const sampleAlgos = [
      { name: "Base-4 Standard", strategy: "base4", density: 2.0, overhead: 0, speed: 85 }
    ];
    const sampleDna = [
      { method: "base4", sequence: "ACGT", hash: "dummy", stats: { density: 2.0, overhead: 0, gcContent: 50.0, homopolymerCount: 0 } }
    ];
    const sampleExps = [
      { hypothesis: "DNA Synthesis: BASE4", accuracy: "100.0% Perfect" }
    ];

    const evaluation = architectService.evaluateArchitecture(sampleAlgos, sampleDna, sampleExps);
    assert.strictEqual(evaluation.success, true);
    assert.ok(evaluation.ranking.length > 0, "Ranking should not be empty");
    assert.strictEqual(evaluation.recommendation.best, "Homopolymer-Safe Encoder");
    console.log("✅ Passed: Storage Architect Service direct methods\n");

    // ── 9. Test Storage Architect Express Routes ───────────────
    console.log("Testing: Storage Architect Express Routes integration...");
    const BASE_ARCH_ROUTE_URL = `http://localhost:${PORT}/api/architecture`;

    const archRes = await fetch(`${BASE_ARCH_ROUTE_URL}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ algorithms: sampleAlgos, dna: sampleDna, experiments: sampleExps })
    });
    assert.strictEqual(archRes.status, 200, "Evaluate route should return 200");
    const archData = await archRes.json();
    assert.strictEqual(archData.success, true);
    assert.strictEqual(archData.recommendation.best, "Homopolymer-Safe Encoder");
    console.log("✅ Passed: Storage Architect Express Routes integration\n");

    // ── 10. Test Company Orchestrator Service ──────────────────
    console.log("Testing: Company Orchestrator Service direct methods...");
    const orchestratorService = require("../src/services/CompanyOrchestratorService");

    const readiness = orchestratorService.generateReadinessReport({});
    assert.strictEqual(readiness.success, true);
    assert.strictEqual(readiness.report.overallCompletionPercentage, 98);
    assert.ok(readiness.report.employees.length > 0);

    const taskSim = orchestratorService.executeAutonomousTask("Test Task", "biologist");
    assert.ok(["COMPLETED", "FAILED"].includes(taskSim.status));
    console.log("✅ Passed: Company Orchestrator Service direct methods\n");

    // ── 11. Test Company Orchestrator Express Routes ───────────
    console.log("Testing: Company Orchestrator Express Routes integration...");
    const BASE_COMPANY_ROUTE_URL = `http://localhost:${PORT}/api/company`;

    const reportRes = await fetch(`${BASE_COMPANY_ROUTE_URL}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.strictEqual(reportRes.status, 200, "Report route should return 200");
    const reportData = await reportRes.json();
    assert.strictEqual(reportData.success, true);
    assert.strictEqual(reportData.report.overallCompletionPercentage, 98);

    const execRes = await fetch(`${BASE_COMPANY_ROUTE_URL}/execute-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskName: "Simulate Transcription", agentId: "biologist" })
    });
    assert.strictEqual(execRes.status, 200, "Execute task route should return 200");
    const execData = await execRes.json();
    assert.ok(["COMPLETED", "FAILED"].includes(execData.status));
    console.log("✅ Passed: Company Orchestrator Express Routes integration\n");

    // ── 12. Test Tasks Express Routes ──────────────────────────
    console.log("Testing: Tasks Express Routes integration...");
    const BASE_TASKS_URL = `http://localhost:${PORT}/tasks`;

    // A. Clean up / read initial tasks
    const initialTasksRes = await fetch(BASE_TASKS_URL);
    assert.strictEqual(initialTasksRes.status, 200, "GET /tasks should return 200");
    const initialTasks = await initialTasksRes.json();
    assert.ok(Array.isArray(initialTasks), "GET /tasks should return an array");
    const initialLength = initialTasks.length;

    // B. Create a new task (POST /tasks)
    console.log("  - POST /tasks (create task)");
    const createTaskRes = await fetch(BASE_TASKS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Test Task Alpha",
        description: "Verify that backend persistent storage works.",
        phase: "Testing",
        column: "todo",
        assignee: "QA Engineer",
        priority: "high"
      })
    });
    assert.strictEqual(createTaskRes.status, 201, "POST /tasks should return 201 created");
    const taskData = await createTaskRes.json();
    assert.ok(taskData.id, "Created task should have an ID");
    assert.strictEqual(taskData.title, "Test Task Alpha");
    assert.strictEqual(taskData.phase, "Testing");
    assert.strictEqual(taskData.column, "todo");
    assert.strictEqual(taskData.assignee, "QA Engineer");
    assert.strictEqual(taskData.priority, "high");
    assert.ok(taskData.createdAt, "Created task should have createdAt timestamp");

    // C. Test duplicate checking
    console.log("  - POST /tasks (duplicate block)");
    const dupTaskRes = await fetch(BASE_TASKS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "  test task alpha  ", // leading/trailing spaces and mixed casing
        phase: "testing",
        description: "This is a duplicate",
        column: "inprogress"
      })
    });
    assert.strictEqual(dupTaskRes.status, 400, "POST /tasks with duplicate title+phase should return 400");
    const dupData = await dupTaskRes.json();
    assert.ok(dupData.error, "Duplicate error response should contain error message");

    // D. Verify task list updated
    console.log("  - GET /tasks (list update)");
    const updatedTasksRes = await fetch(BASE_TASKS_URL);
    const updatedTasks = await updatedTasksRes.json();
    assert.strictEqual(updatedTasks.length, initialLength + 1, "Tasks list count should increase by 1");
    const foundTask = updatedTasks.find(t => t.id === taskData.id);
    assert.ok(foundTask, "The created task should be in the retrieved tasks list");

    // E. Update task column (PATCH /tasks/:id)
    console.log(`  - PATCH /tasks/${taskData.id} (move column)`);
    const updateTaskRes = await fetch(`${BASE_TASKS_URL}/${taskData.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        column: "inprogress"
      })
    });
    assert.strictEqual(updateTaskRes.status, 200, "PATCH /tasks/:id should return 200");
    const updatedTaskData = await updateTaskRes.json();
    assert.strictEqual(updatedTaskData.column, "inprogress", "Task column should be updated to 'inprogress'");

    // F. Delete task (DELETE /tasks/:id)
    console.log(`  - DELETE /tasks/${taskData.id} (delete task)`);
    const deleteTaskRes = await fetch(`${BASE_TASKS_URL}/${taskData.id}`, {
      method: "DELETE"
    });
    assert.strictEqual(deleteTaskRes.status, 200, "DELETE /tasks/:id should return 200");
    const deleteData = await deleteTaskRes.json();
    assert.strictEqual(deleteData.task.id, taskData.id, "Returned deleted task should match the ID");

    // G. Verify deletion
    const finalTasksRes = await fetch(BASE_TASKS_URL);
    const finalTasks = await finalTasksRes.json();
    assert.strictEqual(finalTasks.length, initialLength, "Tasks length should revert to initial size");
    const deletedTaskLookup = finalTasks.find(t => t.id === taskData.id);
    assert.ok(!deletedTaskLookup, "Deleted task should no longer exist in the tasks list");

    console.log("✅ Passed: Tasks Express Routes integration\n");

    // ── 13. Test DNA Health Check Express Routes ───────────────
    console.log("Testing: DNA Health Check Express Routes integration...");
    const BASE_HEALTH_CHECK_URL = `http://localhost:${PORT}/dna-health-check`;

    // A. Run first health check (should find and fix 2 corrupted sequences)
    console.log("  - POST /dna-health-check (first run - correction expected)");
    const firstCheckRes = await fetch(BASE_HEALTH_CHECK_URL, { method: "POST" });
    assert.strictEqual(firstCheckRes.status, 200, "POST /dna-health-check should return 200");
    const firstCheckData = await firstCheckRes.json();

    assert.strictEqual(firstCheckData.scanned_count, 3, "Scanned count should be 3");
    assert.strictEqual(firstCheckData.corrupted_found, 2, "Corrupted count should be 2 (sim_2 and sim_3)");
    assert.strictEqual(firstCheckData.fixed_count, 2, "Fixed count should be 2 (both repaired via majority-vote)");
    assert.ok(Array.isArray(firstCheckData.details), "Details should be an array");

    const sim1Report = firstCheckData.details.find(d => d.id === "sim_1");
    assert.strictEqual(sim1Report.status, "healthy");

    const sim2Report = firstCheckData.details.find(d => d.id === "sim_2");
    assert.strictEqual(sim2Report.status, "fixed");
    assert.strictEqual(sim2Report.fixed_sequence, "ACGTACGTACGTACGT");

    const sim3Report = firstCheckData.details.find(d => d.id === "sim_3");
    assert.strictEqual(sim3Report.status, "fixed");
    assert.strictEqual(sim3Report.fixed_sequence, "ACGTACGTACGTACGT");

    // B. Run second health check (everything should be healthy now)
    console.log("  - POST /dna-health-check (second run - all healthy expected)");
    const secondCheckRes = await fetch(BASE_HEALTH_CHECK_URL, { method: "POST" });
    assert.strictEqual(secondCheckRes.status, 200, "POST /dna-health-check should return 200");
    const secondCheckData = await secondCheckRes.json();

    assert.strictEqual(secondCheckData.scanned_count, 3);
    assert.strictEqual(secondCheckData.corrupted_found, 0);
    assert.strictEqual(secondCheckData.fixed_count, 0);

    // C. Get previous health check runs history
    console.log("  - GET /dna-health-check/logs (retrieve logs)");
    const logsRes = await fetch(`${BASE_HEALTH_CHECK_URL}/logs`);
    assert.strictEqual(logsRes.status, 200, "GET /dna-health-check/logs should return 200");
    const logsData = await logsRes.json();
    assert.ok(Array.isArray(logsData), "Logs should be an array");
    assert.strictEqual(logsData.length, 2, "There should be exactly 2 run history logs recorded");

    // D. Test simulations.json corruption handling
    console.log("  - POST /dna-health-check (simulations.json corruption handling)");
    const simulationsFilePath = path.join(__dirname, "../simulations.json");
    const validSimulationsBackup = await fs.readFile(simulationsFilePath, "utf8");

    try {
      // Intentionally corrupt the simulations file
      await fs.writeFile(simulationsFilePath, "{ corrupted json string: [invalid] }");

      const corruptedRes = await fetch(BASE_HEALTH_CHECK_URL, { method: "POST" });
      assert.strictEqual(corruptedRes.status, 422, "Corrupted simulations file should return 422 status");
      const corruptedData = await corruptedRes.json();
      assert.strictEqual(corruptedData.error, "simulations.json is corrupted", "Should return correct error message");
      assert.ok(corruptedData.details, "Should contain error details");
      console.log("    ✓ Gracefully handled corrupted simulations.json with 422 error response");
    } finally {
      // Always restore the backup to maintain database state
      await fs.writeFile(simulationsFilePath, validSimulationsBackup);
    }

    // E. Test legacy/unfixable format handling in health check
    console.log("  - POST /dna-health-check (unfixable/legacy format handling)");
    try {
      const legacyMockData = [
        {
          id: "sim_legacy_1",
          name: "BRCA1 Legacy Missing Checksum",
          sequence: "ACGTACGTACGTACGT"
          // Missing checksum and triplicates
        },
        {
          id: "sim_legacy_2",
          name: "BRCA1 Legacy Missing Triplicates",
          sequence: "ACGTACGTACGGACGT",
          checksum: "cf573e65038d08ff910a3345642ffd1e8329844633c2dcb15964b324ebdba4d0"
          // Missing triplicates
        },
        {
          id: "sim_legacy_3",
          name: "BRCA1 Unfixable Majority Mismatch",
          sequence: "ACGTACGTACGGACGT",
          checksum: "cf573e65038d08ff910a3345642ffd1e8329844633c2dcb15964b324ebdba4d0",
          triplicates: [
            "ACGTACGTACGGACGT",
            "ACGTACGTACGGACGT",
            "ACGTACGTACGGACGT" // Majority vote is incorrect, won't match checksum
          ]
        }
      ];

      await fs.writeFile(simulationsFilePath, JSON.stringify(legacyMockData, null, 2));

      const legacyRes = await fetch(BASE_HEALTH_CHECK_URL, { method: "POST" });
      assert.strictEqual(legacyRes.status, 200, "POST /dna-health-check should return 200 even with unfixable records");
      const legacyData = await legacyRes.json();

      assert.strictEqual(legacyData.scanned_count, 3);
      assert.strictEqual(legacyData.corrupted_found, 3);
      assert.strictEqual(legacyData.fixed_count, 0);

      const r1 = legacyData.details.find(d => d.id === "sim_legacy_1");
      assert.strictEqual(r1.status, "corrupted_unfixable");
      assert.strictEqual(r1.corrupted_id, "sim_legacy_1");
      assert.strictEqual(r1.reason, "unable to fix - legacy format");

      const r2 = legacyData.details.find(d => d.id === "sim_legacy_2");
      assert.strictEqual(r2.status, "corrupted_unfixable");
      assert.strictEqual(r2.corrupted_id, "sim_legacy_2");
      assert.strictEqual(r2.reason, "unable to fix - legacy format");

      const r3 = legacyData.details.find(d => d.id === "sim_legacy_3");
      assert.strictEqual(r3.status, "corrupted_unfixable");
      assert.strictEqual(r3.corrupted_id, "sim_legacy_3");
      assert.strictEqual(r3.reason, "unable to fix - majority-voted sequence hash mismatch");

      console.log("    ✓ Successfully verified unfixable reasons and corrupted_id responses");
    } finally {
      // Restore valid backup
      await fs.writeFile(simulationsFilePath, validSimulationsBackup);
    }

    console.log("✅ Passed: DNA Health Check Express Routes integration\n");

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
