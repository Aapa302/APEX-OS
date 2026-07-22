let initializeApp, cert, getFirestore;

try {
  // Try modern modular imports (firebase-admin v10+)
  const appModule = require("firebase-admin/app");
  const firestoreModule = require("firebase-admin/firestore");
  initializeApp = appModule.initializeApp;
  cert = appModule.cert;
  getFirestore = firestoreModule.getFirestore;
  console.log("[Firebase] [DEBUG-LOG] Successfully resolved firebase-admin modular imports (app & firestore).");
} catch (e) {
  console.warn("[Firebase] [DEBUG-LOG] Modular imports failed, falling back to legacy firebase-admin namespace import:", e.message);
  const admin = require("firebase-admin");
  initializeApp = admin.initializeApp;
  cert = admin.cert || (admin.credential && admin.credential.cert);
  getFirestore = admin.firestore;
}

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

    console.log(`[Firebase] [DEBUG-LOG] typeof initializeApp: ${typeof initializeApp}`);
    console.log(`[Firebase] [DEBUG-LOG] typeof cert: ${typeof cert}`);
    console.log(`[Firebase] [DEBUG-LOG] typeof getFirestore: ${typeof getFirestore}`);

    if (!cert || typeof cert !== "function") {
      throw new Error("Unable to resolve Firebase Admin credential cert helper.");
    }
    if (!initializeApp || typeof initializeApp !== "function") {
      throw new Error("Unable to resolve Firebase Admin initializeApp helper.");
    }

    const credentialObj = cert(serviceAccount);

    // Initialize Admin SDK with service account credentials
    initializeApp({
      credential: credentialObj
    });

    if (typeof getFirestore === "function") {
      console.log("[Firebase] [DEBUG-LOG] Initializing Firestore via resolved getFirestore().");
      db = getFirestore();
    } else {
      throw new Error("Unable to resolve Firebase Admin getFirestore helper.");
    }

    console.log("[Firebase] Successfully connected to Firestore database.");
  } catch (error) {
    console.error("[Firebase] Error parsing or initializing Firebase Admin SDK:", error.message);
    console.error("[Firebase] Full initialization error stack:", error);
  }
} else {
  console.warn("[Firebase] WARNING: FIREBASE_SERVICE_ACCOUNT environment variable is not defined. Falling back to file-based local storage.");
}

module.exports = { db };
