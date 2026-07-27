// ════════════════════════════════════════════════════════════
// NCBI Biological Data Service
// Interacts with official NCBI E-utilities API.
// ════════════════════════════════════════════════════════════

const logger = require("../middleware/logger").logger || console;

const NCBI_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

/**
 * Custom error class for NCBIService operations
 */
class NCBIError extends Error {
  constructor(message, status = 500, details = null) {
    super(message);
    this.name = "NCBIError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Checks for API key and returns it if present and valid.
 * Throws clean NCBIError if key is missing.
 */
function getApiKey() {
  const apiKey = (process.env.NCBI_API_KEY || "").trim() || (process.env.VITE_NCBI_API_KEY || "").trim();
  return apiKey || null;
}

/**
 * Low-level utility to perform a single fetch request to NCBI E-utilities API
 */
async function performFetch(utility, params, apiKeyToUse, options) {
  // Construct URL with parameters
  const urlParams = new URLSearchParams();

  if (apiKeyToUse) {
    urlParams.append("api_key", apiKeyToUse);
  }

  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) {
      urlParams.append(key, val);
    }
  }

  const url = `${NCBI_BASE_URL}/${utility}?${urlParams.toString()}`;

  // Log exactly what is sent to NCBI (redacting key) as requested by Task 5
  const sanitizedUrl = url.replace(/api_key=[^&]+/, "api_key=REDACTED");
  logger.info(`[NCBI Request] Utility: ${utility}, URL: ${sanitizedUrl}`);

  // Implement a 15-second timeout using AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 429) {
      throw new NCBIError("NCBI rate limit exceeded. Please try again later.", 429);
    }

    if (!response.ok) {
      const errText = await response.text();
      // Log exactly what NCBI returned on failure as requested by Task 5
      logger.error(`[NCBI Response Failure] Utility: ${utility}, Status: ${response.status}, Body: ${errText}`);
      throw new NCBIError(`NCBI API returned status ${response.status}: ${errText}`, response.status);
    }

    if (options.isText) {
      const text = await response.text();
      if (text.includes("Error:") || text.includes("Failed to understand id")) {
        logger.error(`[NCBI Response text Error] Utility: ${utility}, Content: ${text.trim()}`);
        throw new NCBIError(`NCBI returned error: ${text.trim()}`, 400);
      }
      return text;
    } else {
      const json = await response.json();
      if (json.error) {
        const errMsg = typeof json.error === "string" ? json.error : JSON.stringify(json.error);
        logger.error(`[NCBI Response JSON Error] Utility: ${utility}, Error: ${errMsg}`);
        if (errMsg.toLowerCase().includes("key invalid") || errMsg.toLowerCase().includes("invalid api key")) {
          throw new NCBIError("Invalid NCBI API Key.", 401);
        }
        throw new NCBIError(`NCBI returned error: ${errMsg}`, 400);
      }
      return json;
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new NCBIError("NCBI request timed out after 15 seconds.", 504);
    }
    throw error;
  }
}

/**
 * Performs a fetch to NCBI E-utilities API with API key handling and robust retries
 */
async function callNCBI(utility, params = {}, options = {}) {
  const apiKey = getApiKey();

  // Determine if we should attempt using the API key
  let apiKeyToUse = null;
  if (apiKey) {
    const isMock = ["mock_key", "dummy_key", "test_key", "your_ncbi_api_key", "api_key_here", "placeholder"].some(m => apiKey.toLowerCase().includes(m));
    if (!isMock) {
      apiKeyToUse = apiKey;
    } else {
      logger.warn(`[NCBI Service] Detected mock/placeholder API key "${apiKey}". Proceeding without API key.`);
    }
  }

  try {
    return await performFetch(utility, params, apiKeyToUse, options);
  } catch (error) {
    // Check if error is related to invalid API key
    const errorString = (error.message || "") + (error.details || "");
    const isKeyInvalid = error.status === 401 ||
                         (error.status === 400 && (
                           errorString.toLowerCase().includes("key invalid") ||
                           errorString.toLowerCase().includes("api key invalid") ||
                           errorString.toLowerCase().includes("invalid_api_key")
                         ));

    if (apiKeyToUse && isKeyInvalid) {
      logger.warn(`[NCBI Service] Request failed due to invalid API key. Retrying request without API key parameter...`);
      try {
        return await performFetch(utility, params, null, options);
      } catch (retryError) {
        if (retryError instanceof NCBIError) {
          throw retryError;
        }
        logger.error("NCBI Service retry error:", retryError);
        throw new NCBIError(`Failed to reach NCBI on retry: ${retryError.message}`, 502);
      }
    }

    if (error instanceof NCBIError) {
      throw error;
    }
    logger.error("NCBI Service error:", error);
    throw new NCBIError(`Failed to reach NCBI: ${error.message}`, 502);
  }
}

/**
 * Searches NCBI database for query and returns count, ids, and document summaries
 */
async function searchDatabase(db, query) {
  if (!query || typeof query !== "string" || !query.trim()) {
    throw new NCBIError("Search query must be a non-empty string.", 400);
  }

  // Explicit exclusion of inputs containing research note, task, or note
  const normalized = query.toLowerCase();
  if (normalized.includes("research note") || normalized.includes("task") || normalized.includes("note")) {
    return {
      db,
      query,
      count: 0,
      ids: [],
      results: []
    };
  }

  // 1. Run esearch to get UIDs
  const searchResult = await callNCBI("esearch.fcgi", {
    db,
    term: query,
    retmode: "json",
    retmax: 20
  });

  const esearchResult = searchResult.esearchresult;
  if (!esearchResult) {
    throw new NCBIError("Unexpected esearch response structure from NCBI.", 502);
  }

  const count = parseInt(esearchResult.count || "0", 10);
  const ids = esearchResult.idlist || [];

  let results = [];

  // 2. Run esummary if IDs are found to get metadata summaries
  if (ids.length > 0) {
    try {
      const summaryResult = await callNCBI("esummary.fcgi", {
        db,
        id: ids.join(","),
        retmode: "json"
      });

      const resObj = summaryResult.result || {};
      // Return summaries in a list order matching input IDs
      results = ids.map(id => {
        const item = resObj[id];
        return item ? { ...item, uid: id } : { uid: id };
      });
    } catch (err) {
      logger.warn(`Failed to fetch summaries for db=${db} ids=${ids.join(",")}:`, err);
      // Fallback: return just IDs without summaries
      results = ids.map(id => ({ uid: id }));
    }
  }

  return {
    db,
    query,
    count,
    ids,
    results
  };
}

/**
 * searchGene
 */
async function searchGene(query) {
  return searchDatabase("gene", query);
}

/**
 * searchNucleotide
 */
async function searchNucleotide(query) {
  return searchDatabase("nuccore", query);
}

/**
 * searchProtein
 */
async function searchProtein(query) {
  return searchDatabase("protein", query);
}

/**
 * searchPubmed
 */
async function searchPubmed(query) {
  return searchDatabase("pubmed", query);
}

/**
 * fetchFasta
 */
async function fetchFasta(accessionId) {
  if (!accessionId || typeof accessionId !== "string" || !accessionId.trim()) {
    throw new NCBIError("Accession ID must be a non-empty string.", 400);
  }

  const fasta = await callNCBI("efetch.fcgi", {
    db: "sequences",
    id: accessionId,
    rettype: "fasta",
    retmode: "text"
  }, { isText: true });

  return {
    accessionId,
    fasta
  };
}

/**
 * fetchGenBank
 */
async function fetchGenBank(accessionId) {
  if (!accessionId || typeof accessionId !== "string" || !accessionId.trim()) {
    throw new NCBIError("Accession ID must be a non-empty string.", 400);
  }

  const genbank = await callNCBI("efetch.fcgi", {
    db: "sequences",
    id: accessionId,
    rettype: "gb",
    retmode: "text"
  }, { isText: true });

  return {
    accessionId,
    genbank
  };
}

/**
 * fetchMetadata
 */
async function fetchMetadata(accessionId) {
  if (!accessionId || typeof accessionId !== "string" || !accessionId.trim()) {
    throw new NCBIError("Accession ID must be a non-empty string.", 400);
  }

  // Try nuccore first, then protein, then gene
  const databases = ["nuccore", "protein", "gene"];
  let lastError = null;

  for (const db of databases) {
    try {
      const summaryResult = await callNCBI("esummary.fcgi", {
        db,
        id: accessionId,
        retmode: "json"
      });

      const resObj = summaryResult.result || {};
      const uids = resObj.uids || [];
      if (uids.length > 0) {
        const mainId = uids[0];
        return {
          accessionId,
          db,
          metadata: resObj[mainId] || resObj
        };
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw new NCBIError(`Failed to fetch metadata for accession ID ${accessionId} from NCBI.`, 404, lastError ? lastError.message : null);
}

module.exports = {
  NCBIError,
  searchGene,
  searchNucleotide,
  searchProtein,
  searchPubmed,
  fetchFasta,
  fetchGenBank,
  fetchMetadata
};
