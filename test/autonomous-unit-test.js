const assert = require("assert");
const fs = require("fs").promises;
const path = require("path");

// Mock environment
process.env.GEMINI_API_KEY = "dummy_key";
process.env.AI_PROVIDER = "gemini";
process.env.NCBI_API_KEY = "dummy_key";

const geminiService = require("../src/services/geminiService");
const { runAutonomousCEOCheck } = require("../src/services/ceoAutonomousService");

async function runUnitTests() {
  console.log("🛠️ Running Autonomous CEO Unit & Security Verification Tests...\n");

  const LOG_FILE = path.join(__dirname, "../ceo-autonomous-log.json");

  // A. BACK UP ORIGINAL LOG FILE IF EXISTS
  let originalLogsBackup = null;
  try {
    originalLogsBackup = await fs.readFile(LOG_FILE, "utf8");
  } catch (e) {}

  try {
    // Clear log file for deterministic test
    await fs.writeFile(LOG_FILE, "[]");

    // Let's directly test the intercept loop and capping logic in generateContentWithRetry
    console.log("  - Verification 1: Safe Tool Execution & Cap Limit Logic");
    const mockOpts = {
      isAutonomous: true,
      autonomousToolsExecuted: 0,
      rejectedAttempts: [],
      actionsTaken: [],
      authHeader: "Bearer mock-test-token"
    };

    // Inject mock fetch to intercept local executeTool HTTP requests
    const originalFetch = global.fetch;
    const executedHttpTools = [];

    // We can simulate a response from Gemini that includes multiple tool calls
    const mockGeminiResponse = {
      candidates: [{
        content: {
          parts: [
            {
              functionCall: {
                name: "create_task",
                args: { title: "Autonomous Reminder", phase: "Research" }
              }
            },
            {
              functionCall: {
                name: "trigger_dna_health_scan",
                args: {}
              }
            },
            {
              // Disallowed tool!
              functionCall: {
                name: "delete_task",
                args: { id: "12345" }
              }
            }
          ]
        },
        finishReason: "STOP"
      }]
    };

    // Mock fetch response from the actual Gemini API
    let fetchCallCount = 0;
    global.fetch = async (url, options = {}) => {
      // 1. Mock Gemini API call
      if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          // First call: returns the candidate with 3 tool calls
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(mockGeminiResponse)
          };
        } else {
          // Subsequent calls in sequential loop: return normal response
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              candidates: [{
                content: { parts: [{ text: "Done taking actions." }] },
                finishReason: "STOP"
              }]
            })
          };
        }
      }

      // 2. Intercept local tool execution requests
      if (typeof url === "string" && url.startsWith("http://localhost")) {
        executedHttpTools.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, message: `Mocked ${url}` })
        };
      }

      return originalFetch(url, options);
    };

    // Run the actual generateContent with autonomous flag!
    const response = await geminiService.generateContent(
      [{ role: "user", content: "Review company state" }],
      "You are APEX AI CEO",
      mockOpts
    );

    // Assertions
    console.log("    => Total tools executed:", mockOpts.autonomousToolsExecuted);
    console.log("    => Actions Taken list:", mockOpts.actionsTaken.map(a => a.tool));
    console.log("    => Rejected Attempts list:", mockOpts.rejectedAttempts.map(a => `${a.tool} (${a.reason})`));

    // Cap limit: max 2 tools executed
    assert.strictEqual(mockOpts.autonomousToolsExecuted, 2, "Capping must limit execution to exactly 2 tools");
    assert.strictEqual(mockOpts.actionsTaken.length, 2, "Actions taken must be 2");
    assert.strictEqual(mockOpts.actionsTaken[0].tool, "create_task");
    assert.strictEqual(mockOpts.actionsTaken[1].tool, "trigger_dna_health_scan");

    // Rejection of prohibited tools & exceeded limits
    assert.strictEqual(mockOpts.rejectedAttempts.length, 1, "There should be exactly 1 rejected attempt");
    assert.strictEqual(mockOpts.rejectedAttempts[0].tool, "delete_task");
    assert.strictEqual(mockOpts.rejectedAttempts[0].reason, "Unauthorized tool in autonomous mode");

    console.log("  ✅ Passed: Blocked delete_task and capped actions to 2 successfully!\n");

    // Clean up mock fetch
    global.fetch = originalFetch;

  } finally {
    // Restore original logs backup
    if (originalLogsBackup !== null) {
      await fs.writeFile(LOG_FILE, originalLogsBackup);
    }
  }

  console.log("🎉 All Autonomous CEO Unit Verification tests passed!");
}

runUnitTests().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
