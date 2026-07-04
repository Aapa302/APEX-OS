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
function toAnthropicResponse(geminiData) {
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
    model: config.geminiModel,
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
 * Calls Gemini's generateContent endpoint.
 *
 * @param {Array} messages - Anthropic-shaped messages array
 * @param {string} system - system prompt text
 * @param {object} opts - { jsonMode: boolean, maxTokens: number }
 * @returns {Promise<object>} Anthropic-shaped response: { content: [{type:"text", text}] }
 */
async function generateContent(messages, system, opts = {}) {
  const { jsonMode = false, maxTokens = 1000 } = opts;

  const url = `${GEMINI_BASE_URL}/models/${config.geminiModel}:generateContent`;

  const body = {
    contents: toGeminiContents(messages),
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.7,
    },
  };

  if (system && system.trim()) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  if (jsonMode) {
    body.generationConfig.response_mime_type = "application/json";
  }

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.geminiApiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new GeminiError(`Network error calling Gemini: ${networkErr.message}`, 502);
  }

  let data;
  const rawText = await res.text();
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new GeminiError(`Gemini returned non-JSON response (status ${res.status})`, 502, rawText.slice(0, 500));
  }

  if (!res.ok) {
    const apiMessage = data?.error?.message || `Gemini API error (status ${res.status})`;
    throw new GeminiError(apiMessage, res.status, data?.error || null);
  }

  return toAnthropicResponse(data);
}

module.exports = { generateContent, GeminiError, toGeminiContents, toAnthropicResponse };
