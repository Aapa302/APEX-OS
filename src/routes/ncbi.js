// ════════════════════════════════════════════════════════════
// NCBI Route Handlers
// Mounted under /api/ncbi/
// ════════════════════════════════════════════════════════════

const express = require("express");
const router = express.Router();
const ncbiService = require("../services/NCBIService");

/**
 * Helper to handle route errors consistently and return clear JSON
 */
function handleRouteError(err, res) {
  const status = err.status || 500;
  let type = "ncbi_error";

  if (status === 401) {
    type = "invalid_api_key";
  } else if (status === 429) {
    type = "rate_limit_exceeded";
  } else if (status === 504) {
    type = "request_timeout";
  } else if (status === 400 || status === 404) {
    type = "invalid_request";
  } else if (status === 502) {
    type = "network_failure";
  }

  return res.status(status).json({
    error: {
      type,
      message: err.message || "An error occurred during the NCBI operation.",
      ...(err.details ? { details: err.details } : {})
    }
  });
}

// POST /api/ncbi/search-gene
router.post("/search-gene", async (req, res) => {
  try {
    const { query } = req.body;
    const result = await ncbiService.searchGene(query);
    return res.json(result);
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// POST /api/ncbi/search-nucleotide
router.post("/search-nucleotide", async (req, res) => {
  try {
    const { query } = req.body;
    const result = await ncbiService.searchNucleotide(query);
    return res.json(result);
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// POST /api/ncbi/search-protein
router.post("/search-protein", async (req, res) => {
  try {
    const { query } = req.body;
    const result = await ncbiService.searchProtein(query);
    return res.json(result);
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// POST /api/ncbi/search-pubmed
router.post("/search-pubmed", async (req, res) => {
  try {
    const { query } = req.body;
    const result = await ncbiService.searchPubmed(query);
    return res.json(result);
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// POST /api/ncbi/fetch-fasta
router.post("/fetch-fasta", async (req, res) => {
  try {
    const { accessionId } = req.body;
    const result = await ncbiService.fetchFasta(accessionId);
    return res.json(result);
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// POST /api/ncbi/fetch-genbank
router.post("/fetch-genbank", async (req, res) => {
  try {
    const { accessionId } = req.body;
    const result = await ncbiService.fetchGenBank(accessionId);
    return res.json(result);
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// POST /api/ncbi/fetch-metadata
router.post("/fetch-metadata", async (req, res) => {
  try {
    const { accessionId } = req.body;
    const result = await ncbiService.fetchMetadata(accessionId);
    return res.json(result);
  } catch (err) {
    return handleRouteError(err, res);
  }
});

module.exports = router;
