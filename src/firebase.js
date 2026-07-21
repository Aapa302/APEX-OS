const admin = require("firebase-admin");

let db = null;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    // Initialize Admin SDK with service account credentials
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log("[Firebase] Successfully connected to Firestore database.");
  } catch (error) {
    console.error("[Firebase] Error parsing or initializing Firebase Admin SDK:", error.message);
  }
} else {
  console.warn("[Firebase] WARNING: FIREBASE_SERVICE_ACCOUNT environment variable is not defined. Falling back to file-based local storage.");
}

module.exports = { db };
