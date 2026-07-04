#!/usr/bin/env node
// ════════════════════════════════════════════════════════════
// Test runner: runs all test files in sequence.
// Usage:
//   npm test                     — runs unit + integration tests
//   npm test -- --live           — also runs live tests (needs server)
// ════════════════════════════════════════════════════════════

const { execSync, spawnSync } = require("child_process");
const path = require("path");

const TESTS = [
  { file: "test/geminiService.test.js", name: "Unit Tests (no deps)" },
  { file: "test/integration.test.js",   name: "Integration Tests (mocked fetch)" },
];

const args = process.argv.slice(2);
const liveTesting = args.includes("--live");

if (liveTesting) {
  TESTS.push({ file: "test/live.test.js", name: "Live Server Tests (needs running server)" });
}

let allPassed = true;

console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║        APEX Gemini Proxy — Test Suite                    ║");
console.log("╚══════════════════════════════════════════════════════════╝\n");

for (const { file, name } of TESTS) {
  console.log(`\n▶ Running: ${name}`);
  console.log("─".repeat(60));
  const result = spawnSync("node", [path.resolve(__dirname, "..", file)], {
    stdio: "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    allPassed = false;
    console.log(`\n❌ ${name} FAILED (exit code ${result.status})`);
  } else {
    console.log(`\n✅ ${name} PASSED`);
  }
}

console.log("\n╔══════════════════════════════════════════════════════════╗");
if (allPassed) {
  console.log("║  🎉 ALL TEST SUITES PASSED                               ║");
} else {
  console.log("║  ⚠️  ONE OR MORE SUITES FAILED                           ║");
}
console.log("╚══════════════════════════════════════════════════════════╝");
process.exit(allPassed ? 0 : 1);
