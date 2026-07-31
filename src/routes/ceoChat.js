const express = require("express");
const StorageService = require("../services/StorageService");

const router = express.Router();

/**
 * GET / — returns all ceo_chats
 */
router.get("/", async (req, res, next) => {
  try {
    const messages = await StorageService.getAll("ceo_chats");
    // Sort messages chronologically by timestamp
    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    res.json(messages);
  } catch (error) {
    next(error);
  }
});

/**
 * POST / — creates a new ceo_chats entry
 */
router.post("/", async (req, res, next) => {
  try {
    const { id, role, content, display, streaming, loading, autonomous, source, timestamp } = req.body;

    if (!role || !content) {
      return res.status(400).json({
        error: {
          type: "invalid_request",
          message: "Missing required fields: 'role' and 'content' are required."
        }
      });
    }

    const messageId = id || "msg_" + Date.now().toString() + "_" + Math.random().toString(36).substring(2, 7);

    const newMessage = {
      id: messageId.toString(),
      role,
      content,
      display: display || null,
      streaming: streaming || false,
      loading: loading || false,
      autonomous: autonomous || false,
      source: source || null,
      timestamp: timestamp || new Date().toISOString()
    };

    await StorageService.save("ceo_chats", newMessage);
    res.status(201).json(newMessage);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE / — clears the ceo_chats history
 */
router.delete("/", async (req, res, next) => {
  try {
    const messages = await StorageService.getAll("ceo_chats");
    for (const msg of messages) {
      await StorageService.delete("ceo_chats", msg.id);
    }
    res.json({ success: true, message: "CEO Chat conversation cleared successfully." });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
