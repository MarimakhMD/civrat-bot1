const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const logger = require("../utils/logger");
module.exports = {
  name: "messageUpdate",
  once: false,
  async execute(oldMessage, newMessage) {
    try {
      if (!newMessage.guild || newMessage.author?.bot || oldMessage.content === newMessage.content) return;
      await getLogsRuntime().handleMessageUpdated(newMessage);
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("messageUpdate handling failed", { event: "message_update_failed", guildId: newMessage?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
