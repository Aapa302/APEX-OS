const fs = require("fs").promises;
const path = require("path");
const StorageService = require("./StorageService");
const { generateContent } = require("./geminiService");

const LOG_FILE = path.join(__dirname, "../../ceo-autonomous-log.json");
const HEALTH_LOGS_FILE = path.join(__dirname, "../../dna-health-logs.json");

// Helper to write/append to ceo-autonomous-log.json safely
async function appendAutonomousLog(entry) {
  try {
    let logs = [];
    try {
      const data = await fs.readFile(LOG_FILE, "utf8");
      logs = JSON.parse(data);
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error("[Autonomous CEO] Error reading log file:", err.message);
      }
    }
    logs.push(entry);
    await fs.writeFile(LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
  } catch (err) {
    console.error("[Autonomous CEO] Failed to write autonomous log:", err.message);
  }
}

async function runAutonomousCEOCheck() {
  console.info(`[Autonomous CEO] Initiating corporate autonomous state check at ${new Date().toISOString()}`);

  try {
    // 1. Gather current state:
    // A. All tasks
    const allTasks = await StorageService.getAll("tasks");

    // B. Filter stale tasks (in "todo" status for > 48 hours without update)
    const now = Date.now();
    const fortyEightHoursAgo = now - (48 * 60 * 60 * 1000);
    const staleTasks = allTasks.filter(t => {
      const status = t.status || t.column;
      if (status !== "todo") return false;
      const createdTime = t.createdAt ? new Date(t.createdAt).getTime() : 0;
      return createdTime > 0 && createdTime < fortyEightHoursAgo;
    });

    // C. Latest DNA health scan summary and last scan timestamp
    let latestHealthLog = null;
    let isHealthScanStale = true;
    try {
      const logData = await fs.readFile(HEALTH_LOGS_FILE, "utf8");
      const healthLogs = JSON.parse(logData);
      if (healthLogs && healthLogs.length > 0) {
        latestHealthLog = healthLogs[healthLogs.length - 1];
        const lastScanTime = new Date(latestHealthLog.timestamp).getTime();
        isHealthScanStale = (now - lastScanTime) > (24 * 60 * 60 * 1000); // > 24 hours
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn("[Autonomous CEO] Warning reading dna-health-logs.json:", err.message);
      }
    }

    const stateSummary = {
      timestamp: new Date().toISOString(),
      tasksSummary: {
        total: allTasks.length,
        todo: allTasks.filter(t => (t.status || t.column) === "todo").length,
        inprogress: allTasks.filter(t => (t.status || t.column) === "inprogress").length,
        review: allTasks.filter(t => (t.status || t.column) === "review").length,
        done: allTasks.filter(t => (t.status || t.column) === "done").length,
      },
      staleTasks: staleTasks.map(t => ({
        id: t.id,
        title: t.title,
        createdAt: t.createdAt,
        assignee: t.assignee,
        priority: t.priority
      })),
      latestDnaHealth: latestHealthLog ? {
        timestamp: latestHealthLog.timestamp,
        scanned_count: latestHealthLog.scanned_count,
        corrupted_found: latestHealthLog.corrupted_found,
        fixed_count: latestHealthLog.fixed_count,
        isStale: isHealthScanStale
      } : { message: "No health check run yet.", isStale: true }
    };

    // 2. Pass this state to Gemini
    const systemPrompt = `You are APEX — the autonomous AI Chief Executive Officer of the company.
Your job is to review the current company state periodically and take safe, proactive actions on your own — without waiting for the user to ask — but ONLY within a strict, limited set of safe actions.

THE AVAILABLE SAFE ACTIONS ARE:
1. create_task: Use this to create a reminder/follow-up task if something is stale, overdue, or if a new action is required.
2. create_research_note: Use this to log strategic observations, recommendations, or insights about the current state.
3. trigger_dna_health_scan: Use this to trigger a full DNA health check scan to scan and repair DNA simulations. Only trigger this if the last scan is more than 24 hours old.

MANDATORY RULES:
- You must NOT try to update or delete tasks.
- You can take a MAXIMUM of 2 actions per run.
- If no action is warranted, simply explain your decision (e.g., "Company is in an optimal state, no autonomous actions needed.") and do not call any tools.
- Output a clear summary of your strategic review and decision-making process first, then call the appropriate tools if needed.`;

    const userMessage = `Here is the current gathered company state:
\`\`\`json
${JSON.stringify(stateSummary, null, 2)}
\`\`\`

Review this state. Check if any tasks have been in To Do for over 48 hours and need attention, or if DNA health check is outdated. Take appropriate safe actions if needed (max 2 tool calls total).`;

    const opts = {
      isAutonomous: true,
      autonomousToolsExecuted: 0,
      rejectedAttempts: [],
      actionsTaken: [],
      authHeader: "Bearer mock-test-token" // Use compatible bearer token
    };

    const response = await generateContent(
      [{ role: "user", content: userMessage }],
      systemPrompt,
      opts
    );

    const decisionText = response.content?.[0]?.text || "No response content from Gemini.";

    // 3. Log the run
    const logEntry = {
      timestamp: new Date().toISOString(),
      reviewedState: stateSummary,
      decision: decisionText,
      actionsTaken: opts.actionsTaken || [],
      rejectedAttempts: opts.rejectedAttempts || []
    };

    await appendAutonomousLog(logEntry);
    console.info(`[Autonomous CEO] Completed autonomous check successfully. Executed: ${opts.actionsTaken.length} actions, Rejected: ${opts.rejectedAttempts.length} attempts.`);

  } catch (err) {
    console.error("[Autonomous CEO] Error during autonomous check run:", err);
    // Log execution failure
    await appendAutonomousLog({
      timestamp: new Date().toISOString(),
      error: err.message,
      stack: err.stack
    });
  }
}

module.exports = {
  runAutonomousCEOCheck
};
