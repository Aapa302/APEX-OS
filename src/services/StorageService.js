const fs = require("fs").promises;
const path = require("path");
const { db } = require("../firebase");

const FILE_MAP = {
  simulations: path.join(__dirname, "../../simulations.json"),
  research_notes: path.join(__dirname, "../../research-reports.json"),
  hypotheses: path.join(__dirname, "../../hypotheses.json"),
  experiments: path.join(__dirname, "../../experiments.json"),
  tasks: path.join(__dirname, "../../tasks.json")
};

// Helper to load raw array from local JSON
async function readLocalJSON(collectionName) {
  const filePath = FILE_MAP[collectionName];
  if (!filePath) {
    throw new Error(`Unknown collection name: ${collectionName}`);
  }
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(filePath, JSON.stringify([], null, 2), "utf8");
      return [];
    }
    throw error;
  }
}

// Helper to save raw array atomically to local JSON
async function writeLocalJSON(collectionName, data) {
  const filePath = FILE_MAP[collectionName];
  if (!filePath) {
    throw new Error(`Unknown collection name: ${collectionName}`);
  }
  const tempPath = filePath + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
}

const StorageService = {
  isFirestoreEnabled() {
    return db !== null;
  },

  // GET all records
  async getAll(collectionName) {
    if (this.isFirestoreEnabled()) {
      try {
        const snapshot = await db.collection(collectionName).get();
        const list = [];
        snapshot.forEach(doc => {
          list.push({ ...doc.data() });
        });
        return list;
      } catch (error) {
        console.error(`[Firestore] Error getting collection ${collectionName}, falling back:`, error.message);
        return await readLocalJSON(collectionName);
      }
    } else {
      return await readLocalJSON(collectionName);
    }
  },

  // GET single record by ID
  async getById(collectionName, id) {
    if (this.isFirestoreEnabled()) {
      try {
        const doc = await db.collection(collectionName).doc(id).get();
        if (doc.exists) {
          return doc.data();
        }
        return null;
      } catch (error) {
        console.error(`[Firestore] Error getting document ${id} from ${collectionName}, falling back:`, error.message);
        const list = await readLocalJSON(collectionName);
        return list.find(item => item.id === id) || null;
      }
    } else {
      const list = await readLocalJSON(collectionName);
      return list.find(item => item.id === id) || null;
    }
  },

  // SAVE or CREATE record (by ID)
  async save(collectionName, item) {
    if (!item.id) {
      throw new Error("Missing 'id' field in saved item.");
    }
    if (this.isFirestoreEnabled()) {
      try {
        await db.collection(collectionName).doc(item.id).set(item);
        return item;
      } catch (error) {
        console.error(`[Firestore] Error saving to ${collectionName}, falling back:`, error.message);
        return await this.saveLocal(collectionName, item);
      }
    } else {
      return await this.saveLocal(collectionName, item);
    }
  },

  async saveLocal(collectionName, item) {
    const list = await readLocalJSON(collectionName);
    const index = list.findIndex(existing => existing.id === item.id);
    if (index !== -1) {
      list[index] = item;
    } else {
      list.push(item);
    }
    await writeLocalJSON(collectionName, list);
    return item;
  },

  // UPDATE specific fields of a record
  async update(collectionName, id, updates) {
    if (this.isFirestoreEnabled()) {
      try {
        await db.collection(collectionName).doc(id).update(updates);
        const doc = await db.collection(collectionName).doc(id).get();
        return doc.data();
      } catch (error) {
        console.error(`[Firestore] Error updating doc ${id} in ${collectionName}, falling back:`, error.message);
        return await this.updateLocal(collectionName, id, updates);
      }
    } else {
      return await this.updateLocal(collectionName, id, updates);
    }
  },

  async updateLocal(collectionName, id, updates) {
    const list = await readLocalJSON(collectionName);
    const index = list.findIndex(existing => existing.id === id);
    if (index === -1) {
      throw new Error(`Item with id '${id}' not found in ${collectionName}.`);
    }
    const updatedItem = { ...list[index], ...updates };
    list[index] = updatedItem;
    await writeLocalJSON(collectionName, list);
    return updatedItem;
  },

  // DELETE record by ID
  async delete(collectionName, id) {
    if (this.isFirestoreEnabled()) {
      try {
        await db.collection(collectionName).doc(id).delete();
        return true;
      } catch (error) {
        console.error(`[Firestore] Error deleting doc ${id} from ${collectionName}, falling back:`, error.message);
        return await this.deleteLocal(collectionName, id);
      }
    } else {
      return await this.deleteLocal(collectionName, id);
    }
  },

  async deleteLocal(collectionName, id) {
    const list = await readLocalJSON(collectionName);
    const index = list.findIndex(existing => existing.id === id);
    if (index === -1) {
      return false;
    }
    list.splice(index, 1);
    await writeLocalJSON(collectionName, list);
    return true;
  }
};

module.exports = StorageService;
