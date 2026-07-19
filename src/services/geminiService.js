// ════════════════════════════════════════════════════════════
// Gemini Service
//
// Calls Google's Gemini API and returns a response shaped exactly
// like Anthropic's /v1/messages response, so the APEX OS frontend
// (which was built against the Claude API) needs zero changes to
// its parsing logic — only the request URL changes.
//
// Reference: https://ai.google.dev/api/generate-content
// ════════════════════════════════════════════════════════════

const config = require("../config/env");
const { getActiveModel, resolveModel } = require("./GeminiModelResolver");

const CEO_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "create_task",
        description: "Creates a new task in the Task Board/To Do list.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "The title of the task (required)" },
            description: { type: "string", description: "The description or details of the task" },
            phase: { type: "string", description: "The phase/department of the task, e.g. Research, Algorithm, DNA Synthesis, Simulation, Architecture Recommendation, Product, etc. (required)" },
            column: { type: "string", enum: ["todo", "inprogress", "review", "done"], description: "The column status of the task. Defaults to 'todo'" },
            assignee: { type: "string", description: "The ID or name of the employee assigned" },
            priority: { type: "string", enum: ["low", "medium", "high"], description: "The priority of the task. Defaults to 'medium'" }
          },
          required: ["title", "phase"]
        }
      },
      {
        name: "update_task",
        description: "Updates an existing task in the Task Board (e.g. changing column/status, description, assignee, etc.).",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "The ID of the task to update (required)" },
            column: { type: "string", enum: ["todo", "inprogress", "review", "done"], description: "The new column status of the task" },
            status: { type: "string", enum: ["todo", "inprogress", "review", "done"], description: "The new column status of the task (alias for column)" },
            title: { type: "string", description: "The new title of the task" },
            description: { type: "string", description: "The new description of the task" },
            phase: { type: "string", description: "The new phase of the task" },
            assignee: { type: "string", description: "The new assignee of the task" },
            priority: { type: "string", enum: ["low", "medium", "high"], description: "The new priority of the task" }
          },
          required: ["id"]
        }
      },
      {
        name: "trigger_simulation",
        description: "Triggers a new virtual DNA simulation run.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "The name of the simulation run" },
            type: { type: "string", description: "The type of the simulation, e.g. PCR Amplification, Sequencing Profiler, Mutational Stress-test, etc." },
            status: { type: "string", enum: ["queued", "running", "completed"], description: "The initial status of the simulation. Defaults to 'queued'" },
            progress: { type: "integer", description: "The initial progress of the simulation. Defaults to 0" },
            estimatedTime: { type: "string", description: "The estimated time of the simulation, e.g. '1m 15s'" }
          }
        }
      },
      {
        name: "save_research_report",
        description: "Saves a structured scientific research report persistently to the backend store.",
        parameters: {
          type: "object",
          properties: {
            report: {
              type: "object",
              properties: {
                query: { type: "string", description: "The search query or target of the research (required)" },
                executiveSummary: { type: "string", description: "A brief 2-3 sentence executive summary of findings (required)" },
                confidenceScore: { type: "integer", description: "A confidence score from 0 to 100 based on evidence quality (required)" },
                keyFindings: { type: "array", items: { type: "string" }, description: "Specific falsifiable findings as bullets" },
                risks: { type: "array", items: { type: "string" }, description: "Identified risks or challenges" },
                opportunities: { type: "array", items: { type: "string" }, description: "Identified opportunities for the company" },
                recommendations: { type: "array", items: { type: "string" }, description: "Recommendations and next steps" },
                sources: { type: "string", description: "Sources or citations referenced" }
              },
              required: ["query", "executiveSummary", "confidenceScore"]
            }
          },
          required: ["report"]
        }
      },
      {
        name: "get_simulations",
        description: "Retrieves the list of all currently active or saved simulations.",
        parameters: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_tasks",
        description: "Retrieves the list of all currently active or saved tasks.",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    ]
  }
];

async function executeTool(name, args) {
  console.info(`[GeminiToolExecutor] Executing tool via HTTP request: ${name} with args:`, args);
  const baseUrl = `http://localhost:${config.port}`;
  try {
    if (name === "create_task") {
      const res = await fetch(`${baseUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      const data = await res.json();
      if (!res.ok) {
        return { error: data.error || `HTTP error ${res.status}` };
      }
      return data;

    } else if (name === "update_task") {
      const { id, ...updateFields } = args;
      if (!id) {
        return { error: "Task ID is required for update_task." };
      }
      const res = await fetch(`${baseUrl}/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateFields)
      });
      const data = await res.json();
      if (!res.ok) {
        return { error: data.error || `HTTP error ${res.status}` };
      }
      return data;

    } else if (name === "trigger_simulation") {
      const res = await fetch(`${baseUrl}/simulations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      const data = await res.json();
      if (!res.ok) {
        return { error: data.error || `HTTP error ${res.status}` };
      }
      return data;

    } else if (name === "save_research_report") {
      const res = await fetch(`${baseUrl}/research-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
      const data = await res.json();
      if (!res.ok) {
        return { error: data.error || `HTTP error ${res.status}` };
      }
      return data;

    } else if (name === "get_simulations") {
      const res = await fetch(`${baseUrl}/simulations`);
      const data = await res.json();
      if (!res.ok) {
        return { error: `HTTP error ${res.status}` };
      }
      return data;

    } else if (name === "get_tasks") {
      const res = await fetch(`${baseUrl}/tasks`);
      const data = await res.json();
      if (!res.ok) {
        return { error: `HTTP error ${res.status}` };
      }
      return data;
    }

    return { error: `Unknown tool name: ${name}` };
  } catch (err) {
    console.error(`[GeminiToolExecutor] Error executing tool ${name} via HTTP:`, err);
    return { error: err.message };
  }
}

// Throttling and Queueing variables
const apiCallTimestamps = [];
const requestQueue = [];
let isQueueProcessing = false;

// Safe threshold: 15 calls per rolling 60-second window
const LIMIT_WINDOW_MS = 60000;
const LIMIT_MAX_CALLS = 15;

function recordCall() {
  apiCallTimestamps.push(Date.now());
}

function getActiveCallsCount() {
  const now = Date.now();
  while (apiCallTimestamps.length > 0 && now - apiCallTimestamps[0] >= LIMIT_WINDOW_MS) {
    apiCallTimestamps.shift();
  }
  return apiCallTimestamps.length;
}

function getEstimatedWaitMs() {
  const count = getActiveCallsCount();
  if (count < LIMIT_MAX_CALLS) return 0;

  const now = Date.now();
  const oldestTimestamp = apiCallTimestamps[0];
  const waitMs = (oldestTimestamp + LIMIT_WINDOW_MS) - now;
  return Math.max(0, waitMs);
}

function throttleRequest() {
  return new Promise((resolve) => {
    const count = getActiveCallsCount();
    if (count < LIMIT_MAX_CALLS && requestQueue.length === 0) {
      recordCall();
      resolve({ queued: false, queueWaitMs: 0 });
      return;
    }

    const startTime = Date.now();
    const estWaitMs = getEstimatedWaitMs();
    requestQueue.push({ resolve, startTime });

    console.info(`[GeminiQueue] Request queued. Position: ${requestQueue.length}, Est wait: ${Math.ceil(estWaitMs / 1000)}s`);

    startQueueProcessor();
  });
}

function startQueueProcessor() {
  if (isQueueProcessing) return;
  isQueueProcessing = true;
  processQueue();
}

function processQueue() {
  if (requestQueue.length === 0) {
    isQueueProcessing = false;
    return;
  }

  const count = getActiveCallsCount();
  if (count < LIMIT_MAX_CALLS) {
    const nextItem = requestQueue.shift();
    if (nextItem) {
      recordCall();
      const waitTimeMs = Date.now() - nextItem.startTime;
      console.info(`[GeminiQueue] Processing queued request. Waited: ${waitTimeMs}ms. Remaining in queue: ${requestQueue.length}`);
      nextItem.resolve({ queued: true, queueWaitMs: waitTimeMs });
    }
    setTimeout(processQueue, 50);
  } else {
    const delay = getEstimatedWaitMs();
    setTimeout(processQueue, Math.max(delay, 100));
  }
}

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_FALLBACK_URL = "https://generativelanguage.googleapis.com/v1";

/**
 * Converts Anthropic-shaped `messages` (role: "user"|"assistant",
 * content: string | [{type:"text"|"image", ...}]) into Gemini's
 * `contents` array (role: "user"|"model", parts: [{text}|{inlineData}]).
 */
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

/**
 * Wraps Gemini's response text in the exact shape the APEX OS
 * frontend expects from Claude: { content: [{ type: "text", text }] }
 */
function toAnthropicResponse(geminiData, actualModel) {
  const candidate = geminiData?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("");
  const finishReason = candidate?.finishReason || "UNKNOWN";

  console.info(`[GeminiResponse] Generated response text. finishReason: ${finishReason}, length: ${text.length} chars`);

  if (!text && candidate?.finishReason && candidate.finishReason !== "STOP") {
    // Model refused, hit a safety filter, or ran out of tokens with no output.
    throw new GeminiError(
      `Gemini returned no text (finishReason: ${candidate.finishReason})`,
      502
    );
  }

  return {
    content: [{ type: "text", text }],
    model: actualModel || config.geminiModel,
    provider: "gemini",
  };
}

class GeminiError extends Error {
  constructor(message, status = 502, details = null) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Calls Gemini's generateContent endpoint with retry logic and robust model fallbacks.
 *
 * @param {Array} messages - Anthropic-shaped messages array
 * @param {string} system - system prompt text
 * @param {object} opts - { jsonMode: boolean, maxTokens: number, temperature: number, top_p: number }
 * @returns {Promise<object>} Anthropic-shaped response: { content: [{type:"text", text}] }
 */
async function generateContent(messages, system, opts = {}) {
  const throttleResult = await throttleRequest();
  const result = await generateContentWithRetry(messages, system, opts, false, false);
  if (throttleResult.queued) {
    result.queued = true;
    result.queueWaitMs = throttleResult.queueWaitMs;
  }
  return result;
}

async function makeApiCallWithFallback(body, urls, model, isRetry, quotaRetryDone) {
  let lastError = null;

  for (const url of urls) {
    const cleanUrl = url.split("?")[0];
    console.info(`[GeminiService] Attempting model [${model}] at endpoint: ${cleanUrl}`);

    let retryCount = 0;
    const maxRetries = 1;

    while (retryCount <= maxRetries) {
      let res;
      try {
        const authenticatedUrl = `${url}${url.includes('?') ? '&' : '?'}key=${config.geminiApiKey}`;
        res = await fetch(authenticatedUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      } catch (networkErr) {
        console.error(`[GeminiService] Fetch failed for ${cleanUrl}:`, networkErr.message);
        lastError = new GeminiError(`Network error calling Gemini: ${networkErr.message}`, 502);
        break; // try next endpoint
      }

      let data;
      const rawText = await res.text();
      try {
        data = JSON.parse(rawText);
      } catch {
        lastError = new GeminiError(`Gemini returned non-JSON response (status ${res.status})`, 502, rawText.slice(0, 500));
        break; // try next endpoint
      }

      const isModelNotFound = res.status === 404 ||
        (data?.error?.message && (
          data.error.message.toLowerCase().includes("not found") ||
          data.error.message.toLowerCase().includes("no longer available") ||
          data.error.message.toLowerCase().includes("not exist")
        ));

      if (isModelNotFound && !isRetry) {
        console.warn(`[GeminiService] Live Gemini API call failed with 404 or "not found" on [${model}]. Initiating self-healing model resolution retry...`);
        try {
          await resolveModel();
          console.info(`[GeminiService] Self-heal complete. Retrying request once with new model [${getActiveModel()}]...`);
          const newModel = getActiveModel();
          const newUrls = [
            `${GEMINI_BASE_URL}/models/${newModel}:generateContent`,
            `${GEMINI_FALLBACK_URL}/models/${newModel}:generateContent`
          ];
          return makeApiCallWithFallback(body, newUrls, newModel, true, quotaRetryDone);
        } catch (resolveErr) {
          console.error(`[GeminiService] Self-healing resolveModel failed:`, resolveErr.message);
        }
      }

      if (!res.ok) {
        console.warn(`[GeminiService] Model [${model}] failed on ${cleanUrl} with status ${res.status}:`, data?.error?.message);

        if (res.status === 404) {
          lastError = new GeminiError(data?.error?.message || "Model not found", 404);
          break; // try next endpoint
        }

        if (res.status === 429) {
          const isQuota = data?.error?.message?.toLowerCase().includes("quota") ||
                          data?.error?.message?.toLowerCase().includes("limit");

          if (isQuota && !quotaRetryDone) {
            let waitSec = 5; // default backoff
            const errMsg = data?.error?.message || "";
            const match = errMsg.match(/(?:retry|wait|after)[^\d]*(\d+(?:\.\d+)?)[^\d]*(?:second|sec|s)/i);
            if (match) {
              waitSec = parseFloat(match[1]);
            }
            console.warn(`[GeminiService] Retrying after quota error, waiting ${waitSec}s. Error details: ${errMsg}`);
            await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
            // Retry the request once with quotaRetryDone = true
            return makeApiCallWithFallback(body, urls, model, isRetry, true);
          }

          if (retryCount < maxRetries) {
            retryCount++;
            const delay = 1000;
            console.warn(`[GeminiService] 429 hit at ${cleanUrl}. Retry ${retryCount}/${maxRetries} in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }

        if (res.status === 503 || res.status === 502 || res.status === 504) {
          lastError = new GeminiError(`Gemini Service Unavailable: ${data?.error?.message || "Service error"}`, res.status, data?.error || null);
          break; // try next endpoint
        }

        const apiMessage = data?.error?.message || `Gemini API error (status ${res.status})`;
        lastError = new GeminiError(apiMessage, res.status, data?.error || null);
        break; // try next endpoint
      }

      console.info(`[GeminiService] Success with model [${model}]`);
      return data;
    }
  }

  throw lastError || new Error(`Failed to reach Gemini for model [${model}] after trying multiple endpoints.`);
}

async function generateContentWithRetry(messages, system, opts = {}, isRetry = false, quotaRetryDone = false) {
  const { jsonMode = false } = opts;
  let maxTokens = opts.maxTokens || 1000;

  // Enforce reasonable safety ceiling (cap at 10000 max)
  if (maxTokens > 10000) {
    maxTokens = 10000;
  }

  // Use strictly the dynamically active resolved model
  const model = getActiveModel();

  // Try both v1beta and v1 endpoints for this model
  const urls = [
    `${GEMINI_BASE_URL}/models/${model}:generateContent`,
    `${GEMINI_FALLBACK_URL}/models/${model}:generateContent`
  ];

  const geminiContents = toGeminiContents(messages);

  if (system && system.trim()) {
    if (geminiContents.length > 0 && geminiContents[0].role === "user") {
      const firstPart = geminiContents[0].parts[0];
      if (firstPart && typeof firstPart.text === "string") {
        firstPart.text = `${system}\n\n${firstPart.text}`;
      } else {
        geminiContents[0].parts.unshift({ text: system });
      }
    } else {
      geminiContents.unshift({
        role: "user",
        parts: [{ text: system }]
      });
    }
  }

  const isCeo = system && (system.includes("You are APEX") || system.includes("AI CEO"));
  let loopCount = 0;
  const maxLoops = 5;

  let currentContents = [...geminiContents];

  while (loopCount < maxLoops) {
    const body = {
      contents: currentContents,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: opts.temperature ?? 0.7,
        topP: opts.top_p ?? 0.95,
        ...(jsonMode && !isCeo ? { response_mime_type: "application/json" } : {})
      }
    };

    if (isCeo) {
      body.tools = CEO_TOOLS;
    }

    console.info(`[GeminiRequest] model: ${model}, maxOutputTokens: ${maxTokens}, jsonMode: ${jsonMode}, isCeo: ${isCeo}, loopCount: ${loopCount}`);

    const data = await makeApiCallWithFallback(body, urls, model, isRetry, quotaRetryDone);

    // Native function calling interceptor and execution loop
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const functionCalls = parts.filter(p => p.functionCall);

    if (functionCalls.length > 0) {
      console.info(`[GeminiService] Model requested ${functionCalls.length} function call(s).`);
      const functionResponseParts = [];
      for (const fc of functionCalls) {
        const result = await executeTool(fc.functionCall.name, fc.functionCall.args);
        functionResponseParts.push({
          functionResponse: {
            name: fc.functionCall.name,
            id: fc.functionCall.id || fc.functionCall.name,
            response: { result }
          }
        });
      }

      // Record the function call in model's turn
      currentContents.push({
        role: "model",
        parts: parts
      });

      // Record the execution results in user's turn
      currentContents.push({
        role: "user",
        parts: functionResponseParts
      });

      loopCount++;
      console.info(`[GeminiService] Continuing conversation turn ${loopCount}/${maxLoops}.`);
      continue;
    }

    return toAnthropicResponse(data, model);
  }

  throw new Error(`Exceeded maximum tool execution loop depth of ${maxLoops}`);
}

/**
 * Fetches the list of available models from Gemini API.
 * Useful for diagnosing model availability issues.
 */
async function listModels() {
  const url = `${GEMINI_BASE_URL}/models?key=${config.geminiApiKey}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Failed to list models: ${res.status}`);
    return data.models || [];
  } catch (err) {
    throw new GeminiError(`Error listing models: ${err.message}`, 500);
  }
}

module.exports = { generateContent, listModels, GeminiError, toGeminiContents, toAnthropicResponse, executeTool };
