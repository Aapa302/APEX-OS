// ════════════════════════════════════════════════════════════
// Validation Middleware
// Validates that every /v1/messages request body has the required
// fields in the shape the frontend sends.
// ════════════════════════════════════════════════════════════

function validateMessagesBody(req, res, next) {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: {
        type: "invalid_request",
        message: '"messages" must be a non-empty array.',
      },
    });
  }

  if (messages.length === 0) {
    return res.status(400).json({
      error: {
        type: "invalid_request",
        message: '"messages" array must not be empty.',
      },
    });
  }

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m.role || !["user", "assistant"].includes(m.role)) {
      return res.status(400).json({
        error: {
          type: "invalid_request",
          message: `messages[${i}].role must be "user" or "assistant".`,
        },
      });
    }
    if (m.content === undefined || m.content === null) {
      return res.status(400).json({
        error: {
          type: "invalid_request",
          message: `messages[${i}].content is required.`,
        },
      });
    }
  }

  next();
}

module.exports = { validateMessagesBody };
