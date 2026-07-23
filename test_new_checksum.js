const http = require("http");
const assert = require("assert");

// Helper to compute standard crc32
function crc32(str) {
  const bytes = Buffer.from(str, "utf8");
  let crc = ~0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return ((~crc) >>> 0).toString();
}

async function makePostRequest(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(JSON.stringify(body))
      }
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, rawBody: data });
        }
      });
    });

    req.on("error", (err) => { reject(err); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function makeGetRequest(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, rawBody: data });
        }
      });
    }).on("error", reject);
  });
}

async function main() {
  console.log("🧪 Starting New Checksum Generation & Verification test...");

  // Start the server in the background if it is not already running
  // We can just query /ping first
  let running = false;
  try {
    const res = await makeGetRequest("http://localhost:8787/ping");
    if (res.status === 200) {
      running = true;
      console.log("✅ APEX OS Server is already running.");
    }
  } catch (e) {
    console.log("Server not running, starting it in a subprocess...");
  }

  let serverProcess = null;
  if (!running) {
    const { spawn } = require("child_process");
    serverProcess = spawn("node", ["src/server.js"], {
      stdio: "inherit",
      env: { ...process.env, PORT: "8787", GEMINI_API_KEY: "dummy_key", AI_PROVIDER: "gemini" }
    });
    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  try {
    const testSequence = "ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG";
    const expectedCrc = crc32(testSequence);
    console.log(`Expected CRC32 of sequence: "${expectedCrc}"`);

    // 1. Save new simulation
    console.log("\n1. Sending POST /api/save-simulation with raw sequence...");
    const saveRes = await makePostRequest("http://localhost:8787/api/save-simulation", {
      name: "Test Checksum Sim",
      sequence: testSequence
      // Notice we are NOT sending any client checksum!
    });

    console.log("Response status:", saveRes.status);
    console.log("Response body:", saveRes.body);

    assert.strictEqual(saveRes.status, 200);
    assert.strictEqual(saveRes.body.success, true);
    assert.ok(saveRes.body.id);
    assert.strictEqual(saveRes.body.checksum, expectedCrc);
    console.log("✅ Passed: Backend calculated the checksum and saved successfully.");

    // 2. Run Auto Scan to confirm health verification
    console.log("\n2. Executing GET /api/dna-health/auto-scan to verify simulation health...");
    const scanRes = await makeGetRequest("http://localhost:8787/api/dna-health/auto-scan");
    console.log("Scan Response Status:", scanRes.status);

    assert.strictEqual(scanRes.status, 200);
    assert.strictEqual(scanRes.body.success, true);

    const savedSimReport = scanRes.body.details.find(d => d.id === saveRes.body.id);
    assert.ok(savedSimReport, "Saved simulation should be scanned");
    assert.strictEqual(savedSimReport.status, "healthy");
    assert.strictEqual(savedSimReport.recovery_status, "Healthy");
    console.log("✅ Passed: New simulation validated perfectly as 'healthy'!");

    console.log("\n🎉 ALL CHECKSUM GENERATION & VERIFICATION TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Test failure:", err);
    process.exit(1);
  } finally {
    if (serverProcess) {
      serverProcess.kill();
    }
  }
}

main();
