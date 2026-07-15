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
  const { jsonMode = false, maxTokens = 1000 } = opts;

  // Prioritized list of models to try.
  // 1. Requested model from parameter (defaults to configured model)
  // 2. Configured model
  // 3. Known stable/high-availability fallbacks
  const preferredModel = opts.model || config.geminiModel || "gemini-flash-latest";
  const fallbackModels = [
    preferredModel,
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-flash-latest",
    "gemini-1.5-flash"
  ];

  // Remove duplicates while preserving prioritized order
  const uniqueModels = Array.from(new Set(fallbackModels));

  let lastError = null;

  for (const model of uniqueModels) {
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

    const body = {
      contents: geminiContents,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: opts.temperature ?? 0.7,
        topP: opts.top_p ?? 0.95,
        ...(jsonMode ? { response_mime_type: "application/json" } : {})
      }
    };

    for (const url of urls) {
      const cleanUrl = url.split("?")[0];
      console.info(`[GeminiService] Attempting model [${model}] at endpoint: ${cleanUrl}`);

      let retryCount = 0;
      // Keep max retries extremely low (1) per endpoint so that we quickly fall back
      // to another model rather than stalling for 60 seconds.
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
          break; // try next endpoint/model
        }

        let data;
        const rawText = await res.text();
        try {
          data = JSON.parse(rawText);
        } catch {
          lastError = new GeminiError(`Gemini returned non-JSON response (status ${res.status})`, 502, rawText.slice(0, 500));
          break; // try next endpoint/model
        }

        if (!res.ok) {
          console.warn(`[GeminiService] Model [${model}] failed on ${cleanUrl} with status ${res.status}:`, data?.error?.message);

          if (res.status === 404) {
            lastError = new GeminiError(data?.error?.message || "Model not found", 404);
            break; // try next endpoint/model
          }

          if (res.status === 429) {
            if (data?.error?.message?.includes("quota") || data?.error?.message?.includes("limit: 0")) {
              lastError = new GeminiError(`Gemini Quota Exceeded. Error: ${data.error.message}`, 429, data.error);
              break; // try next endpoint/model
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
            break; // Immediately try the next endpoint/model instead of waiting!
          }

          const apiMessage = data?.error?.message || `Gemini API error (status ${res.status})`;
          lastError = new GeminiError(apiMessage, res.status, data?.error || null);
          break; // try next endpoint/model
        }

        console.info(`[GeminiService] Success with model [${model}]`);
        return toAnthropicResponse(data, model);
      }
    }
  }

  throw lastError || new Error("Failed to reach Gemini after trying multiple endpoints.");
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

module.exports = { generateContent, listModels, GeminiError, toGeminiContents, toAnthropicResponse };
