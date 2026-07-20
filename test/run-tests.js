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

    // ── 13. Test Simulations Express Routes ────────────────────
    console.log("Testing: Simulations Express Routes integration...");
    const BASE_SIMULATIONS_URL = `http://localhost:${PORT}/simulations`;

    // A. Read initial simulations
    const initialSimsRes = await fetch(BASE_SIMULATIONS_URL);
    assert.strictEqual(initialSimsRes.status, 200, "GET /simulations should return 200");
    const initialSims = await initialSimsRes.json();
    assert.ok(Array.isArray(initialSims), "GET /simulations should return an array");
    const initialSimsLength = initialSims.length;

    // B. Create a new simulation (POST /simulations)
    console.log("  - POST /simulations (create simulation)");
    const createSimRes = await fetch(BASE_SIMULATIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Monte Carlo Sequencing Pass",
        type: "Sequencing Profiler",
        status: "queued",
        progress: 0,
        estimatedTime: "2m 15s"
      })
    });
    assert.strictEqual(createSimRes.status, 201, "POST /simulations should return 201 created");
    const simData = await createSimRes.json();
    assert.ok(simData.id, "Created simulation should have an ID");
    assert.strictEqual(simData.name, "Test Monte Carlo Sequencing Pass");
    assert.strictEqual(simData.type, "Sequencing Profiler");
    assert.strictEqual(simData.status, "queued");
    assert.strictEqual(simData.progress, 0);
    assert.strictEqual(simData.estimatedTime, "2m 15s");

    // C. Verify simulation list count increased
    const updatedSimsRes = await fetch(BASE_SIMULATIONS_URL);
    const updatedSims = await updatedSimsRes.json();
    assert.strictEqual(updatedSims.length, initialSimsLength + 1, "Simulations list count should increase by 1");
    const foundSim = updatedSims.find(s => s.id === simData.id);
    assert.ok(foundSim, "The created simulation should be in the retrieved list");

    // D. Update simulation progress/status (PATCH /simulations/:id)
    console.log(`  - PATCH /simulations/${simData.id} (update progress)`);
    const updateSimRes = await fetch(`${BASE_SIMULATIONS_URL}/${simData.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "running",
        progress: 50,
        estimatedTime: "1m"
      })
    });
    assert.strictEqual(updateSimRes.status, 200, "PATCH /simulations/:id should return 200");
    const updatedSimData = await updateSimRes.json();
    assert.strictEqual(updatedSimData.status, "running", "Simulation status should update to 'running'");
    assert.strictEqual(updatedSimData.progress, 50, "Simulation progress should update to 50");
    assert.strictEqual(updatedSimData.estimatedTime, "1m", "Simulation estimatedTime should update");

    // E. Delete simulation (DELETE /simulations/:id)
    console.log(`  - DELETE /simulations/${simData.id} (delete simulation)`);
    const deleteSimRes = await fetch(`${BASE_SIMULATIONS_URL}/${simData.id}`, {
      method: "DELETE"
    });
    assert.strictEqual(deleteSimRes.status, 200, "DELETE /simulations/:id should return 200");
    const deleteSimData = await deleteSimRes.json();
    assert.strictEqual(deleteSimData.simulation.id, simData.id, "Returned deleted simulation should match the ID");

    // F. Verify deletion
    const finalSimsRes = await fetch(BASE_SIMULATIONS_URL);
    const finalSims = await finalSimsRes.json();
    assert.strictEqual(finalSims.length, initialSimsLength, "Simulations length should revert to initial size");
    const deletedSimLookup = finalSims.find(s => s.id === simData.id);
    assert.ok(!deletedSimLookup, "Deleted simulation should no longer exist in the list");

    console.log("✅ Passed: Simulations Express Routes integration\n");

    // ── 14. Test Team Chat Express Routes ──────────────────────
    console.log("Testing: Team Chat Express Routes integration...");
    const BASE_CHAT_URL = `http://localhost:${PORT}/team-chat`;

    // A. Read initial chat history for an arbitrary employee
    const initialChatRes = await fetch(`${BASE_CHAT_URL}/researcher`);
    assert.strictEqual(initialChatRes.status, 200, "GET /team-chat/:memberId should return 200");
    const initialChat = await initialChatRes.json();
    assert.ok(Array.isArray(initialChat), "GET /team-chat/:memberId should return an array");

    // B. Save a user message (POST /team-chat/:memberId)
    console.log("  - POST /team-chat/:memberId (save message)");
    const saveUserRes = await fetch(`${BASE_CHAT_URL}/researcher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          id: 111111,
          role: "user",
          content: "Hello Dr. Mei Lin",
          display: "Hello Dr. Mei Lin"
        }
      })
    });
    assert.strictEqual(saveUserRes.status, 201, "POST should return 201 created");
    const savedChat = await saveUserRes.json();
    assert.ok(savedChat.length > 0, "Returned array should contain the new message");
    const lastMsg = savedChat[savedChat.length - 1];
    assert.strictEqual(lastMsg.id, 111111);
    assert.strictEqual(lastMsg.role, "user");
    assert.strictEqual(lastMsg.content, "Hello Dr. Mei Lin");

    // C. Save assistant streaming message (POST)
    const saveAssistantRes = await fetch(`${BASE_CHAT_URL}/researcher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          id: 222222,
          role: "assistant",
          content: "",
          streaming: true
        }
      })
    });
    assert.strictEqual(saveAssistantRes.status, 201);

    // D. Update assistant reply (PATCH /team-chat/:memberId)
    console.log("  - PATCH /team-chat/:memberId (update reply)");
    const patchRes = await fetch(`${BASE_CHAT_URL}/researcher`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: 222222,
        content: "Hello! I am Mei.",
        streaming: false
      })
    });
    assert.strictEqual(patchRes.status, 200);
    const patchedHistory = await patchRes.json();
    const patchedMsg = patchedHistory.find(m => m.id === 222222);
    assert.ok(patchedMsg);
    assert.strictEqual(patchedMsg.content, "Hello! I am Mei.");
    assert.strictEqual(patchedMsg.streaming, false);

    // E. Clear Chat (DELETE /team-chat/:memberId)
    console.log("  - DELETE /team-chat/:memberId (clear history)");
    const clearRes = await fetch(`${BASE_CHAT_URL}/researcher`, {
      method: "DELETE"
    });
    assert.strictEqual(clearRes.status, 200);
    const clearedHistory = await clearRes.json();
    assert.strictEqual(clearedHistory.length, 0, "Cleared history should be an empty array");

    console.log("✅ Passed: Team Chat Express Routes integration\n");

    // ── 15. Test Research Reports Express Routes ───────────────
    console.log("Testing: Research Reports Express Routes integration...");
    const BASE_REPORTS_URL = `http://localhost:${PORT}/research-reports`;

    // A. Read initial reports list
    const initialReportsRes = await fetch(BASE_REPORTS_URL);
    assert.strictEqual(initialReportsRes.status, 200, "GET /research-reports should return 200");
    const initialReports = await initialReportsRes.json();
    assert.ok(Array.isArray(initialReports), "GET /research-reports should return an array");
    const initialReportsLength = initialReports.length;

    // B. Save a new report (POST /research-reports)
    console.log("  - POST /research-reports (save report)");
    const createReportRes = await fetch(BASE_REPORTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        report: {
          id: "res_test_12345",
          query: "BRCA1 genetic drift notes",
          executiveSummary: "This represents BRCA1 notes.",
          confidenceScore: 92
        }
      })
    });
    assert.strictEqual(createReportRes.status, 201, "POST /research-reports should return 201 created");
    const savedReport = await createReportRes.json();
    assert.strictEqual(savedReport.id, "res_test_12345");
    assert.strictEqual(savedReport.query, "BRCA1 genetic drift notes");
    assert.strictEqual(savedReport.executiveSummary, "This represents BRCA1 notes.");
    assert.strictEqual(savedReport.confidenceScore, 92);

    // C. Verify report list count increased
    const updatedReportsRes = await fetch(BASE_REPORTS_URL);
    const updatedReports = await updatedReportsRes.json();
    assert.strictEqual(updatedReports.length, initialReportsLength + 1, "Reports count should increase by 1");
    const foundReport = updatedReports.find(r => r.id === "res_test_12345");
    assert.ok(foundReport, "The created report should be in the retrieved list");

    console.log("✅ Passed: Research Reports Express Routes integration\n");

    // ── 16. Test DNA Encoder V1 Express Routes ───────────────────
    console.log("Testing: DNA Encoder V1 Express Routes integration...");
    const BASE_V1_URL = `http://localhost:${PORT}`;

    // Test Encoding
    console.log("  - POST /dna-encode (text -> DNA)");
    const v1EncodeRes = await fetch(`${BASE_V1_URL}/dna-encode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "APEX-1" })
    });
    assert.strictEqual(v1EncodeRes.status, 200, "POST /dna-encode should return 200");
    const v1EncodeData = await v1EncodeRes.json();
    assert.strictEqual(v1EncodeData.success, true);
    assert.ok(v1EncodeData.dna, "Should return encoded DNA sequence");

    // Test Decoding
    console.log("  - POST /dna-decode (DNA -> text)");
    const v1DecodeRes = await fetch(`${BASE_V1_URL}/dna-decode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dna: v1EncodeData.dna })
    });
    assert.strictEqual(v1DecodeRes.status, 200, "POST /dna-decode should return 200");
    const v1DecodeData = await v1DecodeRes.json();
    assert.strictEqual(v1DecodeData.success, true);
    assert.strictEqual(v1DecodeData.text, "APEX-1", "Decoded text must exactly match 'APEX-1'");

    // Test File Encoding
    console.log("  - POST /dna-encode-file (multipart/form-data)");
    const boundary = "----WebKitFormBoundaryAPEXTestBoundary";
    const filename = "small-test-icon.png";
    const mimetype = "image/png";
    const fileBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]); // 16 bytes dummy PNG header

    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`),
      Buffer.from(`Content-Type: ${mimetype}\r\n\r\n`),
      fileBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const fileEncodeRes = await fetch(`${BASE_V1_URL}/dna-encode-file`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: multipartBody
    });
    assert.strictEqual(fileEncodeRes.status, 200, "POST /dna-encode-file should return 200");
    const fileEncodeData = await fileEncodeRes.json();
    assert.strictEqual(fileEncodeData.success, true);
    assert.strictEqual(fileEncodeData.filename, filename);
    assert.strictEqual(fileEncodeData.mimetype, mimetype);
    assert.ok(fileEncodeData.dna);

    // Test File Decoding
    console.log("  - POST /dna-decode-file (DNA -> binary buffer)");
    const fileDecodeRes = await fetch(`${BASE_V1_URL}/dna-decode-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dna: fileEncodeData.dna,
        filename: filename,
        mimetype: mimetype
      })
    });
    assert.strictEqual(fileDecodeRes.status, 200, "POST /dna-decode-file should return 200");
    assert.strictEqual(fileDecodeRes.headers.get("Content-Type"), mimetype);
    assert.ok(fileDecodeRes.headers.get("Content-Disposition").includes(filename));

    // Read response buffer and compare bytes
    const decodedBlob = await fileDecodeRes.arrayBuffer();
    const decodedBuffer = Buffer.from(decodedBlob);
    assert.strictEqual(Buffer.compare(fileBytes, decodedBuffer), 0, "Decoded file buffer must match original byte-for-byte");

    // Test Size Limit (600KB file)
    console.log("  - POST /dna-encode-file size limit check (600KB file)");
    const largeFileBytes = Buffer.alloc(600 * 1024); // 600KB
    const largeMultipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="file"; filename="large.png"\r\n`),
      Buffer.from(`Content-Type: image/png\r\n\r\n`),
      largeFileBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const largeFileRes = await fetch(`${BASE_V1_URL}/dna-encode-file`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: largeMultipartBody
    });
    assert.strictEqual(largeFileRes.status, 400, "POST /dna-encode-file with 600KB file should return 400");
    const largeFileData = await largeFileRes.json();
    assert.strictEqual(largeFileData.error, "File too large for current version");

    console.log("✅ Passed: DNA Encoder V1 Express Routes integration\n");

    // ── 17. Test DNA Synthesizer Express Route ─────────────────
    console.log("Testing: DNA Synthesizer Express Route integration (POST /dna-synthesize)...");

    // A. Valid short sequence synthesis
    console.log("  - POST /dna-synthesize (short sequence ≤ 200bp)");
    const synthShortRes = await fetch(`${BASE_V1_URL}/dna-synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequence: "ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT",
        name: "test_short"
      })
    });
    assert.strictEqual(synthShortRes.status, 200, "Should return 200");
    assert.strictEqual(synthShortRes.headers.get("content-type").includes("text/plain"), true);
    assert.strictEqual(synthShortRes.headers.get("content-disposition").includes('filename="test_short.fasta"'), true);
    const synthShortText = await synthShortRes.text();

    // Check comments
    assert.strictEqual(synthShortText.includes("; APEX DNA Synthesizer Export"), true);
    assert.strictEqual(synthShortText.includes("; Sequence Length: 64 bp"), true);
    assert.strictEqual(synthShortText.includes("; GC Content: 50.00%"), true);
    assert.strictEqual(synthShortText.includes("; Homopolymer Check: PASS"), true);
    // Check header and sequence
    assert.strictEqual(synthShortText.includes(">test_short"), true);
    // Sequence is wrapped to 60 characters per line, so we replace whitespace to verify
    const cleanSynthShortSeq = synthShortText.replace(/;[^\n]*\n/g, "").replace(/>[^\n]*\n/g, "").replace(/\s/g, "");
    assert.strictEqual(cleanSynthShortSeq, "ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT");

    // B. Long sequence synthesis with automatic chunking (> 200bp) and wrapping
    console.log("  - POST /dna-synthesize (long sequence > 200bp with chunking and wrapping)");
    // Generate 250bp sequence with a homopolymer FAIL run
    const longSeq = "A".repeat(10) + "C".repeat(120) + "G".repeat(120); // 250 bp
    const synthLongRes = await fetch(`${BASE_V1_URL}/dna-synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dna: longSeq,
        sequenceName: "test_long"
      })
    });
    assert.strictEqual(synthLongRes.status, 200, "Should return 200");
    const synthLongText = await synthLongRes.text();

    // Check comments
    assert.strictEqual(synthLongText.includes("; Sequence Length: 250 bp"), true);
    assert.strictEqual(synthLongText.includes("; Homopolymer Check: FAIL"), true);
    // Check chunking headers
    assert.strictEqual(synthLongText.includes(">test_long_chunk_1"), true);
    assert.strictEqual(synthLongText.includes(">test_long_chunk_2"), true);
    // Check wrapping - search for 60 char lines
    const lines = synthLongText.split("\n");
    // Verify that DNA sequence lines do not exceed 60-70 characters (using 60)
    for (const line of lines) {
      if (line.trim() && !line.startsWith(";") && !line.startsWith(">")) {
        assert.ok(line.length <= 60, `Sequence line length should be <= 60 characters but was ${line.length}`);
      }
    }

    // C. Validation errors (invalid characters)
    console.log("  - POST /dna-synthesize (invalid characters check)");
    const synthInvalidRes = await fetch(`${BASE_V1_URL}/dna-synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequence: "ACGTACTXCGT"
      })
    });
    assert.strictEqual(synthInvalidRes.status, 400, "Should fail with 400");
    const invalidErr = await synthInvalidRes.json();
    assert.ok(invalidErr.error.includes("invalid characters"), "Should describe invalid characters");

    // D. Validation errors (empty sequence)
    console.log("  - POST /dna-synthesize (empty sequence check)");
    const synthEmptyRes = await fetch(`${BASE_V1_URL}/dna-synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sequence: "   \n  "
      })
    });
    assert.strictEqual(synthEmptyRes.status, 400, "Should fail with 400");
    const emptyErr = await synthEmptyRes.json();
    assert.ok(emptyErr.error.includes("cannot be empty"), "Should describe empty sequence error");

    console.log("✅ Passed: DNA Synthesizer Express Route integration\n");

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
