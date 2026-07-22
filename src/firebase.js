const admin = require("firebase-admin");

let db = null;

console.log("[Firebase] [DEBUG-LOG] Checking FIREBASE_SERVICE_ACCOUNT env var existence...");
const envVar = process.env.FIREBASE_SERVICE_ACCOUNT;
if (envVar) {
  console.log(`[Firebase] [DEBUG-LOG] env var is present, length: ${envVar.length}`);
  try {
    const serviceAccount = JSON.parse(envVar);
    console.log("[Firebase] [DEBUG-LOG] JSON.parse() on FIREBASE_SERVICE_ACCOUNT succeeded.");

    if (serviceAccount && serviceAccount.private_key) {
      const pk = serviceAccount.private_key;
      const startsWithBegin = pk.startsWith("-----BEGIN PRIVATE KEY-----");
      console.log(`[Firebase] [DEBUG-LOG] 'private_key' field exists. Starts with "-----BEGIN PRIVATE KEY-----": ${startsWithBegin}`);
      console.log(`[Firebase] [DEBUG-LOG] 'private_key' length: ${pk.length}`);
      if (pk.includes("\\n")) {
        console.log(`[Firebase] [DEBUG-LOG] WARNING: 'private_key' contains literal "\\n" character sequences.`);
      }
      if (pk.includes("\n")) {
        console.log(`[Firebase] [DEBUG-LOG] INFO: 'private_key' contains actual newline characters.`);
      }
    } else {
      console.log("[Firebase] [DEBUG-LOG] WARNING: serviceAccount is parsed but does not contain a 'private_key' field.");
    }

    // Initialize Admin SDK with service account credentials
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log("[Firebase] Successfully connected to Firestore database.");
  } catch (error) {
    console.error("[Firebase] Error parsing or initializing Firebase Admin SDK:", error.message);
    console.error("[Firebase] Full initialization error stack:", error);
  }
} else {
  console.warn("[Firebase] WARNING: FIREBASE_SERVICE_ACCOUNT environment variable is not defined. Falling back to file-based local storage.");
}

module.exports = { db };
