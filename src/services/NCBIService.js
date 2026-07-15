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
  const apiKey = process.env.NCBI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new NCBIError("NCBI API Key is missing. Please configure NCBI_API_KEY in the environment.", 401);
  }
  return apiKey.trim();
}

/**
 * Performs a fetch to NCBI E-utilities API
 */
async function callNCBI(utility, params = {}, options = {}) {
  const apiKey = getApiKey();

  // Construct URL with parameters
  const urlParams = new URLSearchParams();

  // Only append API key if it's not a mock/dummy/test key
  const isMock = ["mock_key", "dummy_key", "test_key"].includes(apiKey.toLowerCase());
  if (!isMock) {
    urlParams.append("api_key", apiKey);
  }

  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) {
      urlParams.append(key, val);
    }
  }

  const url = `${NCBI_BASE_URL}/${utility}?${urlParams.toString()}`;

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
      throw new NCBIError(`NCBI API returned status ${response.status}: ${errText}`, response.status);
    }

    if (options.isText) {
      const text = await response.text();
      if (text.includes("Error:") || text.includes("Failed to understand id")) {
        throw new NCBIError(`NCBI returned error: ${text.trim()}`, 400);
      }
      return text;
    } else {
      const json = await response.json();
      if (json.error) {
        // e.g. "API key invalid" or similar
        const errMsg = typeof json.error === "string" ? json.error : JSON.stringify(json.error);
        if (errMsg.toLowerCase().includes("key invalid")) {
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
  fetchFasta,
  fetchGenBank,
  fetchMetadata
};
