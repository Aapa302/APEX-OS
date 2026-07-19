const express = require("express");
const fs = require("fs").promises;
const path = require("path");

const router = express.Router();
const CHATS_FILE = path.join(__dirname, "../../team-chats.json");

// Helper to load chats
async function readChats() {
  try {
    const data = await fs.readFile(CHATS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(CHATS_FILE, JSON.stringify({}, null, 2));
      return {};
    }
    throw error;
  }
}

// Helper to save chats
async function writeChats(chats) {
  const tempPath = CHATS_FILE + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(chats, null, 2));
  await fs.rename(tempPath, CHATS_FILE);
}

// GET /team-chat/:memberId
router.get("/:memberId", async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const chats = await readChats();
    const history = chats[memberId] || [];
    res.json(history);
  } catch (error) {
    next(error);
  }
});

// POST /team-chat/:memberId
router.post("/:memberId", async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const { message } = req.body;

    if (!message || !message.role) {
      return res.status(400).json({ error: "Message with a valid role is required." });
    }

    const chats = await readChats();
    if (!chats[memberId]) {
      chats[memberId] = [];
    }

    chats[memberId].push({
      id: message.id || Date.now(),
      role: message.role,
      content: message.content || "",
      display: message.display,
      streaming: !!message.streaming
    });

    await writeChats(chats);
    res.status(201).json(chats[memberId]);
  } catch (error) {
    next(error);
  }
});

// PATCH /team-chat/:memberId — to update streaming status or contents
router.patch("/:memberId", async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const { messageId, content, streaming } = req.body;

    const chats = await readChats();
    const history = chats[memberId] || [];
    const idx = history.findIndex(m => String(m.id) === String(messageId) || (messageId === undefined && m.streaming));

    if (idx === -1) {
      if (history.length > 0) {
        const last = history[history.length - 1];
        if (content !== undefined) last.content = content;
        if (streaming !== undefined) last.streaming = streaming;
      } else {
        return res.status(404).json({ error: "No messages to update." });
      }
    } else {
      const msg = history[idx];
      if (content !== undefined) msg.content = content;
      if (streaming !== undefined) msg.streaming = streaming;
    }

    chats[memberId] = history;
    await writeChats(chats);
    res.json(history);
  } catch (error) {
    next(error);
  }
});

// DELETE /team-chat/:memberId — clears chat history
router.delete("/:memberId", async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const chats = await readChats();
    chats[memberId] = [];
    await writeChats(chats);
    res.json([]);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
