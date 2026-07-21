const fs = require("fs").promises;
const path = require("path");

async function runMigration() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.warn("[Migration] No FIREBASE_SERVICE_ACCOUNT environment variable found. Skipping Firestore migration.");
    return;
  }

  try {
    const admin = require("firebase-admin");
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

    // Check if firebase-admin is already initialized
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }

    const db = admin.firestore();
    console.log("[Migration] Connected to Firestore. Beginning data migration...");

    const fileMappings = {
      simulations: {
        file: path.join(__dirname, "simulations.json"),
        collection: "simulations"
      },
      research_notes: {
        file: path.join(__dirname, "research-reports.json"),
        collection: "research_notes"
      },
      hypotheses: {
        file: path.join(__dirname, "hypotheses.json"),
        collection: "hypotheses"
      },
      experiments: {
        file: path.join(__dirname, "experiments.json"),
        collection: "experiments"
      },
      tasks: {
        file: path.join(__dirname, "tasks.json"),
        collection: "tasks"
      }
    };

    for (const [key, mapping] of Object.entries(fileMappings)) {
      try {
        const dataStr = await fs.readFile(mapping.file, "utf8");
        const list = JSON.parse(dataStr);
        if (Array.isArray(list) && list.length > 0) {
          console.log(`[Migration] Migrating ${list.length} records to collection '${mapping.collection}'...`);
          for (const item of list) {
            if (item && item.id) {
              await db.collection(mapping.collection).doc(item.id).set(item);
            }
          }
          console.log(`[Migration] Successfully migrated '${mapping.collection}' collection.`);
        } else {
          console.log(`[Migration] Local file '${mapping.file}' is empty or not an array. Skipping.`);
        }
      } catch (err) {
        if (err.code === "ENOENT") {
          console.log(`[Migration] Local file '${mapping.file}' does not exist. Skipping.`);
        } else {
          console.error(`[Migration] Error migrating '${key}':`, err.message);
        }
      }
    }

    console.log("[Migration] Firestore migration completed successfully!");
  } catch (error) {
    console.error("[Migration] CRITICAL: Firestore migration failed:", error.message);
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
