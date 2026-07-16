const config = require("../config/env");

let cachedModel = null;
let lastListModelsResponse = null;

function getModelVersion(name) {
  const match = name.match(/gemini-(\d+\.\d+|\d+)/i);
  if (match) {
    return parseFloat(match[1]);
  }
  return 1.0;
}

function rankModels(models) {
  return models.sort((a, b) => {
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    const isFlashA = nameA.includes("flash");
    const isFlashB = nameB.includes("flash");

    if (isFlashA && !isFlashB) return -1;
    if (!isFlashA && isFlashB) return 1;

    const verA = getModelVersion(nameA);
    const verB = getModelVersion(nameB);
    return verB - verA;
  });
}

function getActiveModel() {
  return cachedModel || config.geminiModel || "gemini-2.5-flash";
}

async function probeModel(model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: "Say ok" }] }]
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

async function resolveModel() {
  const listUrl = `https://generativelanguage.googleapis.com/v1/models?key=${config.geminiApiKey}`;
  console.info(`[GeminiModelResolver] Attempting to auto-detect Gemini model via: ${listUrl.split("?")[0]}`);

  try {
    const res = await fetch(listUrl);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`ListModels failed with status ${res.status}: ${errText}`);
    }
    const data = await res.json();

    // Log the FULL raw JSON response (required proof)
    console.log("==================================================");
    console.log("RAW LISTMODELS RESPONSE:");
    console.log(JSON.stringify(data, null, 2));
    console.log("==================================================");

    lastListModelsResponse = data;

    const modelsList = data.models || [];
    const validModels = modelsList.filter(m => {
      const methods = m.supportedGenerationMethods || m.supportedActions || [];
      return methods.includes("generateContent");
    });

    if (validModels.length === 0) {
      throw new Error("No models with supportedGenerationMethod generateContent found in ListModels response.");
    }

    // Rank candidates by preference: flash over pro, highest version first
    const ranked = rankModels(validModels);

    // Check if GEMINI_MODEL env var is explicitly set AND present in ListModels response
    const envModel = process.env.GEMINI_MODEL ? process.env.GEMINI_MODEL.trim() : null;
    if (envModel) {
      const cleanEnvModel = envModel.startsWith("models/") ? envModel.substring(7) : envModel;
      const found = validModels.find(m => {
        const cleanMName = m.name.startsWith("models/") ? m.name.substring(7) : m.name;
        return cleanMName === cleanEnvModel;
      });

      if (found) {
        cachedModel = cleanEnvModel;
        console.info(`[GeminiModelResolver] Resolved Gemini model: ${cachedModel} (preferred explicitly via GEMINI_MODEL)`);
        config.geminiModel = cachedModel;
        return cachedModel;
      } else {
        console.warn(`[GeminiModelResolver] Explicitly requested GEMINI_MODEL [${envModel}] was NOT found in ListModels or does not support generateContent. Falling back to auto-detection.`);
      }
    }

    const selectedModel = ranked[0].name;
    cachedModel = selectedModel.startsWith("models/") ? selectedModel.substring(7) : selectedModel;
    console.log(`Resolved Gemini model: ${cachedModel} (from ${modelsList.length} available models)`);
    config.geminiModel = cachedModel;
    return cachedModel;

  } catch (err) {
    console.warn(`[GeminiModelResolver] ListModels failed (${err.message}). Entering fallback sequence...`);

    const fallbackList = [
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-2.5-pro",
      "gemini-2.0-pro",
      "gemini-flash-latest",
      "gemini-pro-latest"
    ];

    for (const fallbackModel of fallbackList) {
      console.info(`[GeminiModelResolver] Probing fallback candidate [${fallbackModel}]...`);
      const ok = await probeModel(fallbackModel);
      if (ok) {
        cachedModel = fallbackModel;
        console.log(`Resolved Gemini model (Fallback): ${cachedModel}`);
        config.geminiModel = cachedModel;
        return cachedModel;
      }
    }

    // Default emergency fallback
    cachedModel = config.geminiModel || "gemini-2.5-flash";
    console.warn(`[GeminiModelResolver] All fallback probes failed. Defaulting to: ${cachedModel}`);
    config.geminiModel = cachedModel;
    return cachedModel;
  }
}

module.exports = {
  getActiveModel,
  resolveModel,
  getLastListModelsResponse: () => lastListModelsResponse
};
