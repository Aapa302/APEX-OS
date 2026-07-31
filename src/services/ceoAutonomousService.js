const fs = require("fs").promises;
const path = require("path");
const StorageService = require("./StorageService");
const { generateContent } = require("./geminiService");

const LOG_FILE = path.join(__dirname, "../../ceo-autonomous-log.json");
const HEALTH_LOGS_FILE = path.join(__dirname, "../../dna-health-logs.json");

// Tracker for already-nudged stuck tasks to avoid cycle duplicate spamming
const nudgedTaskIds = new Set();
// Threshold constant for detecting stuck tasks (2 hours)
const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000;

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

    // B2. Filter and dispatch proactive alerts for "stuck" tasks (sitting untouched in non-terminal column for > 2 hours)
    const stuckTasks = allTasks.filter(t => {
      const status = t.status || t.column;
      if (status !== "todo" && status !== "inprogress") return false;
      const taskTime = new Date(t.updatedAt || t.createdAt).getTime();
      return taskTime > 0 && (now - taskTime) > STUCK_THRESHOLD_MS && !nudgedTaskIds.has(t.id);
    });

    for (const t of stuckTasks) {
      nudgedTaskIds.add(t.id);
      const timeSpentHours = ((now - new Date(t.updatedAt || t.createdAt).getTime()) / (1000 * 60 * 60)).toFixed(1);
      const nudgeContent = `⚠️ Stuck Task Alert: "${t.title}" assigned to '${t.assignee}' has been sitting in non-terminal column '${t.status || t.column}' for ${timeSpentHours} hours. This needs a strategic nudge!`;

      // Deliver via the existing delivery mechanism (creating a persistent chat message in the CEO Chat history)
      const nudgeMessage = {
        id: "nudge_" + Date.now().toString() + "_" + Math.random().toString(36).substring(2, 7),
        role: "assistant",
        content: nudgeContent,
        autonomous: true,
        source: "autonomous",
        timestamp: new Date().toISOString()
      };
      await StorageService.save("ceo_chats", nudgeMessage);
      console.info(`[Autonomous CEO] Dispatched stuck task nudge for: ${t.title}`);
    }

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

    // D. Fetch recent research notes & experiments for proactive thinking context
    let recentResearchNotes = [];
    let recentExperiments = [];
    try {
      const allNotes = await StorageService.getAll("research_notes");
      recentResearchNotes = allNotes.slice(-5).map(n => ({ id: n.id, title: n.title, category: n.category, date: n.date }));
    } catch (e) {
      console.warn("[Autonomous CEO] Warning reading research_notes:", e.message);
    }

    try {
      const allExps = await StorageService.getAll("experiments");
      recentExperiments = allExps.slice(-5).map(e => ({ id: e.id, hypothesis: e.hypothesis, accuracy: e.accuracy, status: e.status }));
    } catch (e) {
      console.warn("[Autonomous CEO] Warning reading experiments:", e.message);
    }

    // E. Resolve company profile settings
    let companyProfile = {
      name: "APEX BioStorage Corp",
      industry: "Biotechnology & DNA Storage",
      stage: "Growth / Scaled Production",
      mission: "To revolutionize global data archival by encoding digital assets into ultra-stable biological DNA sequences with bit-perfect integrity.",
      goals: "Build, simulate, and deploy the most stable, error-tolerant DNA storage pipelines (Base-4, Huffman, Reed-Solomon, Homopolymer-Safe)."
    };
    try {
      const dbProfile = await StorageService.getById("company", "profile");
      if (dbProfile) {
        companyProfile = { ...companyProfile, ...dbProfile };
      }
    } catch (e) {
      // Ignore
    }

    const stateSummary = {
      timestamp: new Date().toISOString(),
      companyProfile,
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
      recentResearchNotes,
      recentExperiments,
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
Your job is to review the current company state periodically and take safe, proactive actions on your own — without waiting for the user to ask. You should address BOTH reactive requirements (fixing stale tasks or triggering DNA health checks) and proactive requirements (identifying new strategic opportunities, improvement ideas, or risks).

STATED COMPANY MISSION & GOALS:
- Company Name: ${companyProfile.name}
- Industry: ${companyProfile.industry}
- Stage: ${companyProfile.stage}
- Mission: ${companyProfile.mission}
- Primary Goals: ${companyProfile.goals}

YOUR DUAL MANDATE:
1. REACTIVE CYCLE:
   - Check if any tasks are stale (e.g. in To Do status for > 48 hours without update). Propose a reminder task or follow-up note if needed.
   - Check if the DNA health check is stale/outdated (more than 24 hours old). If so, trigger a DNA health scan to repair the simulations.

2. PROACTIVE "THINKING" CYCLE:
   - Proactively consider the company's stated mission/goals and current state (recent tasks, research notes, experiments, DNA health).
   - Identify exactly ONE new strategic opportunity, improvement idea, or risk worth flagging (something you "think of" on your own).
   - Evaluate if this new idea/risk is worth acting on right now.
   - If nothing new is worth proposing this cycle, you must explicitly output "No new proactive idea this cycle" in your summary. Do not force or invent low-quality ideas just to fill space.
   - If you identify a high-quality idea/risk worth acting on, you may take ONE safe action to address it: either create a new task (create_task) to propose the idea/next step, or create a research note (create_research_note) to document your analysis/risk assessment.
   - CRITICAL LABELING RULE: Any proactive task or research note you create MUST have its title prefixed with "💡 Proactive Idea: " (e.g. "💡 Proactive Idea: Explore Base-64 Encrypted DNA Storage"). This is essential for distinct display in the UI.

THE AVAILABLE SAFE ACTIONS ARE:
1. create_task: Create a reminder/follow-up task or propose a proactive strategic idea. (For proactive ideas, title MUST be prefixed with "💡 Proactive Idea: ").
2. create_research_note: Log strategic observations or a proactive risk analysis. (For proactive ideas, title MUST be prefixed with "💡 Proactive Idea: ").
3. trigger_dna_health_scan: Trigger a DNA health scan to scan/repair simulations.

MANDATORY SAFETY RULES:
- You must NOT try to update or delete tasks.
- You can take a MAXIMUM of 2 actions per run (reactive + proactive combined).
- If no action is warranted, explain your decision clearly.
- Output a clear summary of your strategic review, your decision-making process, and any proactive thoughts first, then call the appropriate tools if needed.`;

    const userMessage = `Here is the current gathered company state:
\`\`\`json
${JSON.stringify(stateSummary, null, 2)}
\`\`\`

Review this state. Check if any tasks have been in To Do for over 48 hours and need attention, or if DNA health check is outdated. Additionally, proactively think of exactly ONE new opportunity, improvement, or risk. Take appropriate safe actions if needed (max 2 tool calls total).`;

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

    // 3. Map and label any executed actions
    const loggedActions = (opts.actionsTaken || []).map(action => {
      let isProactive = false;
      const title = action.args?.title || "";
      if (title.startsWith("💡 Proactive Idea:") || title.includes("💡 Proactive Idea:")) {
        isProactive = true;
      }
      return {
        ...action,
        label: isProactive ? "💡 Proactive Idea:" : "🤖 Autonomous Action:"
      };
    });

    let proactiveIdeaFound = "No new proactive idea this cycle";
    const proactiveAction = loggedActions.find(a => a.label === "💡 Proactive Idea:");
    if (proactiveAction) {
      proactiveIdeaFound = proactiveAction.args?.title || "Proactive Idea proposed";
    } else if (decisionText && !decisionText.includes("No new proactive idea this cycle")) {
      const match = decisionText.match(/(?:💡 Proactive Idea:|proactive idea:|opportunity:)\s*([^\n.]+)/i);
      if (match && match[1]) {
        proactiveIdeaFound = "💡 Proactive Idea: " + match[1].trim();
      }
    }

    // Log the run
    const logEntry = {
      timestamp: new Date().toISOString(),
      reviewedState: stateSummary,
      decision: decisionText,
      proactive_idea_considered: proactiveIdeaFound,
      actionsTaken: loggedActions,
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
