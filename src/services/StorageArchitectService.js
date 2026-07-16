// ════════════════════════════════════════════════════════════
// Service: StorageArchitectService
// Handles structural analysis, comparative evaluation, ranking,
// and automated deployment recommendations for DNA Storage Pipelines.
// ════════════════════════════════════════════════════════════

const DNAEngineerService = require("./DNAEngineerService");

const StorageArchitectService = {
  /**
   * Evaluates and ranks all available storage pipelines across 9 metrics.
   * Calculates Stability Score and provides upgrade decisions.
   * @param {Array} algorithms List of available algorithms
   * @param {Array} dnaList List of compiled DNA sequences
   * @param {Array} experiments List of stress tests and simulation runs
   * @returns {Object}
   */
  evaluateArchitecture(algorithms = [], dnaList = [], experiments = []) {
    // Standard algorithms to compare if list is empty
    const defaultAlgos = [
      { name: "Base-4 Standard", strategy: "base4", density: 2.0, overhead: 0, speed: 85 },
      { name: "Huffman DNA Compiler", strategy: "huffman", density: 2.3, overhead: 0, speed: 72 },
      { name: "Reed-Solomon Error-Correction", strategy: "reed-solomon", density: 1.33, overhead: 50, speed: 45 },
      { name: "Homopolymer-Safe Encoder", strategy: "homopolymer-safe", density: 1.0, overhead: 0, speed: 90 }
    ];

    const results = defaultAlgos.map(algo => {
      // Simulate/determine physical performance metrics from real service or specs
      let density = algo.density;
      let overhead = algo.overhead;
      let encodeSpeed = algo.speed; // MB/s
      let decodeSpeed = algo.speed * 0.95; // MB/s
      let accuracy = 100.0;
      let errorRate = 0.0;
      let gcBalance = 50.0;
      let homopolymerAvoidance = 100; // score out of 100

      // Read real stats from compiled DNA if available
      const matchingDna = dnaList.find(d => d.method === algo.strategy);
      if (matchingDna && matchingDna.stats) {
        density = matchingDna.stats.density;
        overhead = matchingDna.stats.overhead;
        gcBalance = matchingDna.stats.gcContent;
        if (matchingDna.stats.homopolymerCount > 0) {
          homopolymerAvoidance = Math.max(0, 100 - matchingDna.stats.homopolymerCount * 20);
        }
      }

      // Read real results from experiments if available
      const matchingExp = experiments.find(e => e.hypothesis && e.hypothesis.toLowerCase().includes(algo.strategy));
      if (matchingExp) {
        if (matchingExp.accuracy) {
          accuracy = parseFloat(matchingExp.accuracy) || 100.0;
          errorRate = parseFloat((100 - accuracy).toFixed(4));
        }
      }

      // Calculate GC balance penalty
      const gcDeviation = Math.abs(50 - gcBalance);
      const gcPenalty = gcDeviation * 1.5;

      // Compute Stability Score (0 - 100)
      // High density, high accuracy, low error, balanced GC, no homopolymers, and robust speed
      let stabilityScore = (accuracy * 0.4) + (homopolymerAvoidance * 0.2) + (encodeSpeed * 0.1) + ((100 - gcPenalty) * 0.2) - (overhead * 0.1);
      stabilityScore = Math.max(0, Math.min(100, parseFloat(stabilityScore.toFixed(2))));

      return {
        name: algo.name,
        strategy: algo.strategy,
        metrics: {
          density: parseFloat(density.toFixed(2)), // bits/nt
          accuracy: parseFloat(accuracy.toFixed(2)), // %
          errorRate: parseFloat(errorRate.toFixed(4)), // %
          gcBalance: parseFloat(gcBalance.toFixed(2)), // %
          homopolymerAvoidance, // score 0-100
          encodeSpeed: parseFloat(encodeSpeed.toFixed(1)), // MB/s
          decodeSpeed: parseFloat(decodeSpeed.toFixed(1)), // MB/s
          overhead: parseFloat(overhead.toFixed(1)), // %
          stabilityScore
        }
      };
    });

    // Sort results by stabilityScore descending
    results.sort((a, b) => b.metrics.stabilityScore - a.metrics.stabilityScore);

    const bestAlgo = results[0];
    const deployedAlgo = results.find(r => r.strategy === "base4") || bestAlgo; // base-4 is standard/initial default

    // Determine replacement/upgrade decision
    let decision = "MAINTAIN";
    let reason = "The current architecture is stable and optimal.";

    if (bestAlgo.strategy !== deployedAlgo.strategy && bestAlgo.metrics.stabilityScore > deployedAlgo.metrics.stabilityScore + 5) {
      decision = "UPGRADE_RECOMMENDED";
      reason = `Recommend upgrading to ${bestAlgo.name}. It offers a stability score of ${bestAlgo.metrics.stabilityScore}% compared to ${deployedAlgo.metrics.stabilityScore}% of the current system.`;
    }

    if (deployedAlgo.metrics.errorRate > 1.0) {
      decision = "IMMEDIATE_REPLACE";
      reason = `CRITICAL: The deployed pipeline has an unacceptable error rate of ${deployedAlgo.metrics.errorRate}%. Immediate replacement with ${bestAlgo.name} is mandatory.`;
    }

    return {
      success: true,
      timestamp: new Date().toISOString(),
      ranking: results,
      recommendation: {
        best: bestAlgo.name,
        strategy: bestAlgo.strategy,
        stabilityScore: bestAlgo.metrics.stabilityScore,
        decision,
        reason
      }
    };
  }
};

module.exports = StorageArchitectService;
